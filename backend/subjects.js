import sql from './db.js';
import { requireRole, newId, str, STAFF, canAccessSection, canAccessSubject } from './auth.js';

const MODES = ['single', 'multiple', 'custom'];

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const session = await requireRole(req, res);
      if (!session) return;
      const uid = session.user_id;
      let rows;
      if (session.user_type === 'student') {
        // A student's sections: their home section plus any joined with a code.
        rows = await sql`
          SELECT * FROM subjects WHERE section_id IN (
            SELECT section_id FROM students WHERE reg_no = ${uid} AND section_id IS NOT NULL
            UNION SELECT section_id FROM enrollments WHERE student_reg_no = ${uid}
          ) ORDER BY name
        `;
      } else if (session.user_type === 'teacher') {
        rows = await sql`
          SELECT * FROM subjects
          WHERE section_id IN (SELECT section_id FROM section_teachers WHERE teacher_id = ${uid})
          ORDER BY name
        `;
      } else {
        rows = await sql`SELECT * FROM subjects ORDER BY name`;
      }
      return res.status(200).json({ ok: true, subjects: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const session = await requireRole(req, res, STAFF);
    if (!session) return;

    const b = req.body;
    const { id, action } = b;
    const has = key => Object.hasOwn(b, key);
    if (has('assignment_mode') && !MODES.includes(b.assignment_mode)) {
      return res.status(400).json({ error: 'Invalid assignment_mode' });
    }
    if (id && !(await canAccessSubject(session, id))) return res.status(403).json({ error: 'Not your subject' });

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      // FK cascades remove its topics, custom topics and submissions.
      await sql`DELETE FROM subjects WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    // Subjects must belong to a section the caller manages.
    if (has('section_id') && !(await canAccessSection(session, b.section_id))) {
      return res.status(403).json({ error: 'Pick a section assigned to you' });
    }

    if (id) {
      // Update: only overwrite the fields that were actually sent.
      const [existing] = await sql`SELECT * FROM subjects WHERE id = ${id}`;
      if (!existing) return res.status(404).json({ error: 'Subject not found' });

      const nextName = has('name') ? str(b.name, 120) : existing.name;
      if (!nextName) return res.status(400).json({ error: 'name required' });
      const nextCode = has('code') ? str(b.code, 40) : existing.code;

      await sql`
        UPDATE subjects
        SET name = ${nextName}, code = ${nextCode || null},
            section_id = ${has('section_id') ? b.section_id : existing.section_id},
            assignment_mode = ${has('assignment_mode') ? b.assignment_mode : existing.assignment_mode}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id });
    }

    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!b.section_id) return res.status(400).json({ error: 'section_id required' });
    const newSubjectId = newId('sub');
    await sql`
      INSERT INTO subjects (id, name, code, section_id, assignment_mode, created_at)
      VALUES (${newSubjectId}, ${name}, ${str(b.code, 40) || null}, ${b.section_id}, ${b.assignment_mode || 'single'}, NOW())
    `;
    return res.status(200).json({ ok: true, id: newSubjectId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
