import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(400).json({ error: 'Method not allowed' });

  const { name, roll, reg, dept, email, password, pass, role, section, year } = req.body;
  const pwd = password ?? pass;

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

      // Students.signup sends a section letter ("A"), while admin roster import
      // may send a real section id. Resolve whichever form we got to a section id.
      let sectionId = null;
      if (section) {
        try {
          const [byId] = await sql`SELECT id FROM sections WHERE id = ${section} LIMIT 1`;
          if (byId) {
            sectionId = byId.id;
          } else {
            const letter = String(section).trim();
            const [byName] = await sql`
              SELECT id FROM sections
              WHERE name ILIKE ${letter}
                 OR name ILIKE ${'Section ' + letter}
                 OR name ILIKE ${'% ' + letter}
              LIMIT 1
            `;
            if (byName) sectionId = byName.id;
          }
        } catch (e) {
          // sections table not set up yet: continue with an unassigned student.
          console.error('section lookup:', e.message);
        }
      }

      const fullYear = Number.parseInt(year, 10);
      const rosterFile = `${String(dept || '').toLowerCase()} ${Number.isFinite(fullYear) ? 2000 + fullYear : ''} ${section || ''}`.replace(/\s+/g, ' ').trim();
      await sql`
        INSERT INTO students (reg_no, name, roll_no, dept, email, email_verified, status, section_id, created_at)
        VALUES (${reg}, ${name}, ${roll}, ${dept}, ${email}, false, 'active', ${sectionId}, NOW())
      `;

      return res.status(200).json({ ok: true, msg: `Account created${rosterFile ? `. Section roster checked: ${rosterFile}.csv` : '.'}` });
    } else if (role === 'teacher') {
      if (!name || !email || !pwd) return res.status(400).json({ error: 'Name, email and password are required' });
      const existing = await sql`SELECT * FROM teachers WHERE email = ${email}`;
      if (existing.length) return res.status(400).json({ error: 'Email already exists' });

      await sql`
        INSERT INTO teachers (id, name, dept, email, password_hash, status)
        VALUES (${'tch_' + Date.now()}, ${name}, ${dept}, ${email}, ${pwd}, 'pending')
      `;

      return res.status(200).json({ ok: true, msg: 'Account created as pending. Awaiting admin approval.' });
    } else if (role === 'admin') {
      if (!name || !email || !pwd) return res.status(400).json({ error: 'Name, email and password are required' });
      const existing = await sql`SELECT * FROM admins WHERE email = ${email}`;
      if (existing.length) return res.status(400).json({ error: 'Email already exists' });

      await sql`
        INSERT INTO admins (id, name, email, password_hash)
        VALUES (${'adm_' + Date.now()}, ${name}, ${email}, ${pwd})
      `;

      return res.status(200).json({ ok: true, msg: 'Admin account created.' });
    }

    return res.status(400).json({ error: 'Invalid role' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
