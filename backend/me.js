import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  const [session] = await sql`SELECT * FROM sessions WHERE token = ${token} AND expires_at > NOW()`;
  if (!session) return res.status(401).json({ error: 'Invalid or expired session' });

  if (session.user_type === 'student') {
    const [user] = await sql`SELECT * FROM students WHERE reg_no = ${session.user_id}`;
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ ok: true, user: { ...user, role: 'student' } });
  } else {
    const [user] = await sql`SELECT * FROM teachers WHERE id = ${session.user_id}`;
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ ok: true, user: { ...user, role: 'teacher' } });
  }
}
