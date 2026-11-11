import sql from './db.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, password, role } = req.body;

  try {
    if (role === 'student') {
      const [user] = await sql`
        SELECT * FROM students WHERE email = ${email} AND status = 'active'
      `;
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      if (!user.email_verified) return res.status(403).json({ error: 'Email not verified' });

      const token = 'sess_' + Date.now() + Math.random().toString(36).slice(2, 10);
      await sql`
        INSERT INTO sessions (token, user_id, user_type, expires_at)
        VALUES (${token}, ${user.reg_no}, 'student', ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()})
      `;

      return res.status(200).json({
        ok: true,
        token,
        user: { id: user.reg_no, name: user.name, regNo: user.reg_no, role: 'student' }
      });
    } else if (role === 'teacher') {
      const [user] = await sql`
        SELECT * FROM teachers WHERE email = ${email}
      `;
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });
      if (user.status === 'pending') return res.status(403).json({ error: 'Awaiting admin approval' });
      if (user.status === 'inactive') return res.status(403).json({ error: 'Account inactive' });

      const token = 'sess_' + Date.now() + Math.random().toString(36).slice(2, 10);
      await sql`
        INSERT INTO sessions (token, user_id, user_type, expires_at)
        VALUES (${token}, ${user.id}, 'teacher', ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()})
      `;

      return res.status(200).json({
        ok: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: 'teacher' }
      });
    } else if (role === 'admin') {
      const [user] = await sql`SELECT * FROM admins WHERE email = ${email}`;
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const token = 'sess_' + Date.now() + Math.random().toString(36).slice(2, 10);
      await sql`
        INSERT INTO sessions (token, user_id, user_type, expires_at)
        VALUES (${token}, ${user.id}, 'admin', ${new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()})
      `;

      return res.status(200).json({
        ok: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, role: 'admin' }
      });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
