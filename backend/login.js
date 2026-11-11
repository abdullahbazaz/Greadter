import sql from './db.js';
import { verifyPassword, isLegacyHash, hashPassword, newToken, str, SESSION_MS } from './auth.js';

const FAIL = 'Invalid credentials';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, role } = req.body;
  const ident = str(req.body.email, 200);
  if (!ident || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Login and password are required' });
  }

  try {
    let user;
    if (role === 'student') {
      [user] = await sql`
        SELECT * FROM students
        WHERE (reg_no = ${ident} OR roll_no = ${ident} OR lower(email) = lower(${ident})) AND status = 'active'
        LIMIT 1
      `;
      if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: `${FAIL}. If an admin imported your account, complete student signup first to set a password.` });
      }
      user = { id: user.reg_no, name: user.name, regNo: user.reg_no, role: 'student' };
    } else if (role === 'teacher') {
      [user] = await sql`SELECT * FROM teachers WHERE lower(email) = lower(${ident}) LIMIT 1`;
      if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: FAIL });
      if (user.status === 'pending') return res.status(403).json({ error: 'Awaiting admin approval' });
      if (user.status !== 'active') return res.status(403).json({ error: 'Account inactive' });
      if (isLegacyHash(user.password_hash)) {
        await sql`UPDATE teachers SET password_hash = ${hashPassword(password)} WHERE id = ${user.id}`;
      }
      user = { id: user.id, name: user.name, email: user.email, role: 'teacher' };
    } else if (role === 'admin') {
      [user] = await sql`SELECT * FROM admins WHERE lower(email) = lower(${ident}) LIMIT 1`;
      if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: FAIL });
      if (isLegacyHash(user.password_hash)) {
        await sql`UPDATE admins SET password_hash = ${hashPassword(password)} WHERE id = ${user.id}`;
      }
      user = { id: user.id, name: user.name, email: user.email, role: 'admin' };
    } else {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const token = newToken();
    await sql`
      INSERT INTO sessions (token, user_id, user_type, expires_at)
      VALUES (${token}, ${user.id}, ${user.role}, ${new Date(Date.now() + SESSION_MS).toISOString()})
    `;
    // Housekeeping: drop expired sessions so the table does not grow forever.
    sql`DELETE FROM sessions WHERE expires_at < NOW()`.catch(() => {});

    return res.status(200).json({ ok: true, token, user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
