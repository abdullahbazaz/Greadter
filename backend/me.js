import sql from './db.js';
import { requireRole } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res);
    if (!session) return;

    let user;
    if (session.user_type === 'student') {
      [user] = await sql`SELECT * FROM students WHERE reg_no = ${session.user_id}`;
    } else if (session.user_type === 'admin') {
      [user] = await sql`SELECT * FROM admins WHERE id = ${session.user_id}`;
    } else {
      [user] = await sql`SELECT * FROM teachers WHERE id = ${session.user_id}`;
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password_hash, ...safeUser } = user;
    return res.status(200).json({ ok: true, user: { ...safeUser, role: session.user_type } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
