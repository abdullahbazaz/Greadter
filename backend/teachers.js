import sql from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!(await requireRole(req, res, ['admin']))) return;
    // Explicit columns: never send password_hash to the browser.
    const rows = await sql`
      SELECT t.id, t.name, t.dept, t.email, t.status,
             COALESCE((SELECT array_agg(st.section_id) FROM section_teachers st WHERE st.teacher_id = t.id), '{}') AS section_ids
      FROM teachers t
      ORDER BY t.name
    `;
    return res.status(200).json({ ok: true, teachers: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
