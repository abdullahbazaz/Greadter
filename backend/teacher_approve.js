import sql from './db.js';
import { requireRole } from './auth.js';

const STATUSES = ['active', 'inactive', 'pending'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!(await requireRole(req, res, ['admin']))) return;
    const { id, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const rows = await sql`UPDATE teachers SET status = ${status} WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Teacher not found' });
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
