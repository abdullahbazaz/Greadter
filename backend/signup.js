import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(400).json({ error: 'Method not allowed' });

  const { name, roll, reg, dept, email, password, role, section, year } = req.body;

  try {
    if (role === 'student') {
      // Check duplicates
      const existing = await sql`SELECT * FROM students WHERE reg_no = ${reg} OR roll_no = ${roll} OR email = ${email}`;
      if (existing.length) return res.status(400).json({ error: 'Registration no., roll no., or email already exists' });

      // TODO: Backend must parse the CSV file named:
      //   "{dept.toLowerCase()} {year} {section}.csv"
      // Example: "cse 2026 A.csv"
      // Look for reg or roll inside that CSV. If not found, reject signup.
      // For now, this step is skipped until CSV file storage is added.

      const fullYear = 2000 + parseInt(year);
      await sql`
        INSERT INTO students (reg_no, name, roll_no, dept, email, email_verified, status, section_id, created_at)
        VALUES (${reg}, ${name}, ${roll}, ${dept}, ${email}, false, 'active', ${section || null}, NOW())
      `;

      return res.status(200).json({ ok: true, msg: `Account created. Awaiting section verification against ${dept.toLowerCase()} ${fullYear} ${section}.csv roster.` });
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
