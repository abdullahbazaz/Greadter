import crypto from 'node:crypto';
import sql from './db.js';
import { requireRole, newId, str, STAFF } from './auth.js';

const joinCode = () => 'GC' + crypto.randomBytes(4).toString('hex').toUpperCase();

// Admission year: accepts 2025 or 25. Returns null for blank, NaN for invalid.
export function batchYear(v) {
  if (v === null || v === undefined || v === '') return null;
  let n = Number(v);
  if (Number.isInteger(n) && n >= 0 && n < 100) n += 2000;
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : NaN;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Join codes are sensitive: admins see all sections, teachers only their own.
      const session = await requireRole(req, res, STAFF);
      if (!session) return;
      const tid = session.user_type === 'admin' ? null : session.user_id;
      const rows = await sql`
        SELECT s.*, d.code AS dept_code
        FROM sections s
        LEFT JOIN departments d ON d.id = s.department_id
        WHERE ${tid}::text IS NULL OR s.id IN (SELECT section_id FROM section_teachers WHERE teacher_id = ${tid})
        ORDER BY d.code, s.batch_year DESC NULLS LAST, s.name
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

    // Bulk: { action: 'bulk', department_id, batch_years: [2026, 2025, ...], names: ['A','B'] }
    // creates every missing batch × name combination in one insert; existing ones are kept.
    if (action === 'bulk') {
      if (!deptId) return res.status(400).json({ error: 'department_id required' });
      const years = Array.isArray(b.batch_years) ? b.batch_years.map(batchYear) : [];
      const names = (Array.isArray(b.names) ? b.names : ['A', 'B']).map(n => str(n, 40)).filter(Boolean);
      if (!years.length || years.some(y => !y) || !names.length) {
        return res.status(400).json({ error: 'batch_years and names required' });
      }
      const combos = years.flatMap(y => names.map(n => ({ y, n })));
      const rows = await sql`
        INSERT INTO sections (id, name, department_id, batch_year, join_code, created_at)
        SELECT id, name, ${deptId}, batch_year, join_code, NOW()
        FROM unnest(${combos.map(() => newId('sec'))}::text[], ${combos.map(c => c.n)}::text[],
                    ${combos.map(c => c.y)}::int[], ${combos.map(() => joinCode())}::text[])
             AS t(id, name, batch_year, join_code)
        ON CONFLICT (department_id, batch_year, name) DO NOTHING
        RETURNING id
      `;
      return res.status(200).json({ ok: true, created: rows.length, skipped: combos.length - rows.length });
    }

    const year = has('batch_year') ? batchYear(b.batch_year) : undefined;
    if (Number.isNaN(year)) return res.status(400).json({ error: 'batch_year must be an admission year like 2025' });

    if (id) {
      // Update: only overwrite the fields that were actually sent.
      const [existing] = await sql`SELECT * FROM sections WHERE id = ${id}`;
      if (!existing) return res.status(404).json({ error: 'Section not found' });

      const nextName = has('name') ? str(b.name, 120) : existing.name;
      if (!nextName) return res.status(400).json({ error: 'name required' });
      const nextCode = has('join_code') ? (str(b.join_code, 40) || joinCode()) : existing.join_code;

      await sql`
        UPDATE sections
        SET name = ${nextName}, department_id = ${deptId ?? existing.department_id},
            batch_year = ${year !== undefined ? year : existing.batch_year}, join_code = ${nextCode}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id });
    }

    const name = str(b.name, 120);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!deptId) return res.status(400).json({ error: 'department_id required' });
    if (!year) return res.status(400).json({ error: 'batch_year (admission year) required' });

    const [dup] = await sql`SELECT id FROM sections WHERE department_id = ${deptId} AND batch_year = ${year} AND name = ${name}`;
    if (dup) return res.status(400).json({ error: `Section ${name} already exists for the ${year} batch` });

    const newSectionId = newId('sec');
    await sql`
      INSERT INTO sections (id, name, department_id, batch_year, join_code, created_at)
      VALUES (${newSectionId}, ${name}, ${deptId}, ${year}, ${str(b.join_code, 40) || joinCode()}, NOW())
    `;
    return res.status(200).json({ ok: true, id: newSectionId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
