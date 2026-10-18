import sql from './db.js';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, roll, reg, dept, email, password, role } = req.body;

  try {
    if (role === 'student') {
      const existing = await sql`SELECT * FROM students WHERE reg_no = ${reg} OR roll_no = ${roll} OR email = ${email}`;
      if (existing.length) return res.status(400).json({ error: 'Registration no., roll no., or email already exists' });

      await sql`
        INSERT INTO students (reg_no, name, roll_no, dept, email, email_verified, status, section_id)
        VALUES (${reg}, ${name}, ${roll}, ${dept}, ${email}, false, 'active', null)
      `;

      return res.status(200).json({ ok: true, msg: 'Account created. Email verification pending (mock).' });
    } else {
      const existing = await sql`SELECT * FROM teachers WHERE email = ${email}`;
      if (existing.length) return res.status(400).json({ error: 'Email already exists' });

      await sql`
        INSERT INTO teachers (id, name, dept, email, password_hash, status)
        VALUES (${'tch_' + Date.now()}, ${name}, ${dept}, ${email}, ${password}, 'pending')
      `;

      return res.status(200).json({ ok: true, msg: 'Account created as pending. Awaiting admin approval.' });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
