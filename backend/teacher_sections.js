import sql from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!(await requireRole(req, res, ['admin']))) return;
    const { teacher_id, section_ids } = req.body;
    if (!teacher_id) return res.status(400).json({ error: 'teacher_id required' });
    if (!Array.isArray(section_ids) || !section_ids.every(s => typeof s === 'string')) {
      return res.status(400).json({ error: 'section_ids must be an array of ids' });
    }
    const ids = [...new Set(section_ids.map(s => s.trim()).filter(Boolean))];

    await sql`DELETE FROM section_teachers WHERE teacher_id = ${teacher_id}`;
    if (ids.length) {
      // One insert for all sections; unknown section ids are ignored.
      await sql`
        INSERT INTO section_teachers (teacher_id, section_id)
        SELECT ${teacher_id}, id FROM sections WHERE id = ANY(${ids})
      `;
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
