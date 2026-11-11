import crypto from 'node:crypto';
import sql from './db.js';
import { requireRole, newId, str, STAFF } from './auth.js';

const joinCode = () => 'GC' + crypto.randomBytes(4).toString('hex').toUpperCase();

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Join codes are sensitive: admins see all sections, teachers only their own.
      const session = await requireRole(req, res, STAFF);
      if (!session) return;
      const rows = session.user_type === 'admin'
        ? await sql`SELECT * FROM sections ORDER BY name`
        : await sql`
            SELECT s.* FROM sections s
            JOIN section_teachers st ON st.section_id = s.id
            WHERE st.teacher_id = ${session.user_id}
            ORDER BY s.name
          `;
      return res.status(200).json({ ok: true, sections: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!(await requireRole(req, res, ['admin']))) return;

    const b = req.body;
    const { id, action } = b;
    const has = key => Object.hasOwn(b, key);

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      // FK cascades remove its subjects (and their topics/submissions) and teacher links;
      // students in it become unassigned (ON DELETE SET NULL).
      await sql`DELETE FROM sections WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    const deptId = has('department_id') ? b.department_id : undefined;
    if (deptId !== undefined) {
      if (!deptId) return res.status(400).json({ error: 'department_id required' });
      const [dep] = await sql`SELECT id FROM departments WHERE id = ${deptId}`;
      if (!dep) return res.status(400).json({ error: 'Department not found' });
    }

    if (id) {
      // Update: only overwrite the fields that were actually sent.
      const [existing] = await sql`SELECT * FROM sections WHERE id = ${id}`;
      if (!existing) return res.status(404).json({ error: 'Section not found' });

      const nextName = has('name') ? str(b.name, 120) : existing.name;
      if (!nextName) return res.status(400).json({ error: 'name required' });
      const nextCode = has('join_code') ? (str(b.join_code, 40) || joinCode()) : existing.join_code;

      await sql`
        UPDATE sections
        SET name = ${nextName}, department_id = ${deptId ?? existing.department_id}, join_code = ${nextCode}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id });
    }

    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!deptId) return res.status(400).json({ error: 'department_id required' });
    const newSectionId = newId('sec');
    await sql`
      INSERT INTO sections (id, name, department_id, join_code, created_at)
      VALUES (${newSectionId}, ${name}, ${deptId}, ${str(b.join_code, 40) || joinCode()}, NOW())
    `;
    return res.status(200).json({ ok: true, id: newSectionId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
