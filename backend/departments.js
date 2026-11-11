import sql from './db.js';
import { requireRole, newId, str } from './auth.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!(await requireRole(req, res, ['admin']))) return;
      const rows = await sql`SELECT * FROM departments ORDER BY code`;
      return res.status(200).json({ ok: true, departments: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!(await requireRole(req, res, ['admin']))) return;

    const { id, action } = req.body;
    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      // FK cascade removes its sections (and their subjects, topics, submissions).
      await sql`DELETE FROM departments WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    const name = str(req.body.name, 120);
    const code = str(req.body.code, 20).toUpperCase();
    if (!name || !code) return res.status(400).json({ error: 'name and code required' });
    const [dup] = await sql`SELECT id FROM departments WHERE code = ${code}`;
    if (dup) return res.status(400).json({ error: 'Department code already exists' });

    const newDeptId = newId('dep');
    await sql`INSERT INTO departments (id, name, code, created_at) VALUES (${newDeptId}, ${name}, ${code}, NOW())`;
    return res.status(200).json({ ok: true, id: newDeptId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
