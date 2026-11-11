import sql from './db.js';
import { bearer } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = bearer(req) || (typeof req.body.token === 'string' ? req.body.token : null);
  if (token) {
    try { await sql`DELETE FROM sessions WHERE token = ${token}`; } catch (e) { console.error(e); }
  }
  return res.status(200).json({ ok: true });
}
