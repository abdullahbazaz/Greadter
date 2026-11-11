import sql from './db.js';
import { getSession, hashPassword, newId, str, EMAIL_RE } from './auth.js';

const MIN_PW = 8;

async function resolveSection(section, dept) {
  if (!section) return null;
  try {
    const [byId] = await sql`SELECT id FROM sections WHERE id = ${section} LIMIT 1`;
    if (byId) return byId.id;
    // Student signup sends a section letter ("A"); match "A", "Section A", "CSE A", ...
    // but only inside the student's own department, since every department has an "A".
    const [byName] = await sql`
      SELECT s.id FROM sections s
      JOIN departments d ON d.id = s.department_id
      WHERE upper(d.code) = upper(${dept || ''})
        AND (s.name ILIKE ${section} OR s.name ILIKE ${'Section ' + section} OR s.name ILIKE ${'% ' + section})
      LIMIT 1
    `;
    return byName ? byName.id : null;
  } catch (e) {
    console.error('section lookup:', e.message);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const b = req.body;
  const role = b.role;
  const name = str(b.name, 120);
  const email = str(b.email, 200);
  const dept = str(b.dept, 60);
  const pwd = typeof (b.password ?? b.pass) === 'string' ? (b.password ?? b.pass) : '';

  try {
    const caller = await getSession(req);
    const isAdmin = caller?.user_type === 'admin';

    if (role === 'student') {
      const reg = str(b.reg, 60), roll = str(b.roll, 60), section = str(b.section, 60);
      if (!reg || !roll || !name) return res.status(400).json({ error: 'Name, registration no. and roll no. are required' });
      // Admin roster import may create password-less rows; self-signup must set a password.
      if (!isAdmin) {
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
        if (pwd.length < MIN_PW) return res.status(400).json({ error: `Password must be at least ${MIN_PW} characters` });
      }
      const sectionId = await resolveSection(section, dept);

      const existing = await sql`
        SELECT reg_no, roll_no, password_hash FROM students
        WHERE reg_no = ${reg} OR roll_no = ${roll} OR (${email} <> '' AND lower(email) = lower(${email}))
      `;

      // A roster-imported student claims their account by matching reg + roll.
      const claimable = !isAdmin && existing.length === 1 && existing[0].reg_no === reg
        && existing[0].roll_no === roll && !existing[0].password_hash;
      if (claimable) {
        await sql`
          UPDATE students
          SET name = ${name}, email = ${email}, password_hash = ${hashPassword(pwd)},
              section_id = COALESCE(section_id, ${sectionId})
          WHERE reg_no = ${reg}
        `;
        return res.status(200).json({ ok: true, msg: 'Account activated. You can log in now.' });
      }
      if (existing.length) return res.status(400).json({ error: 'Registration no., roll no., or email already exists' });

      await sql`
        INSERT INTO students (reg_no, name, roll_no, dept, email, email_verified, status, section_id, password_hash, created_at)
        VALUES (${reg}, ${name}, ${roll}, ${dept}, ${email || null}, false, 'active', ${sectionId},
                ${pwd ? hashPassword(pwd) : null}, NOW())
      `;
      return res.status(200).json({ ok: true, msg: 'Account created.' });
    }

    if (role === 'teacher' || role === 'admin') {
      if (!name || !email || !pwd) return res.status(400).json({ error: 'Name, email and password are required' });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (pwd.length < MIN_PW) return res.status(400).json({ error: `Password must be at least ${MIN_PW} characters` });
    }

    if (role === 'teacher') {
      const existing = await sql`SELECT id FROM teachers WHERE lower(email) = lower(${email})`;
      if (existing.length) return res.status(400).json({ error: 'Email already exists' });
      await sql`
        INSERT INTO teachers (id, name, dept, email, password_hash, status)
        VALUES (${newId('tch_')}, ${name}, ${dept}, ${email}, ${hashPassword(pwd)}, 'pending')
      `;
      return res.status(200).json({ ok: true, msg: 'Account created as pending. Awaiting admin approval.' });
    }

    if (role === 'admin') {
      // Anyone could previously make themselves admin. Now only the very first
      // admin can self-register; after that an existing admin must be logged in.
      if (!isAdmin) {
        const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM admins`;
        if (n > 0) return res.status(403).json({ error: 'Only an existing admin can create admin accounts' });
      }
      const existing = await sql`SELECT id FROM admins WHERE lower(email) = lower(${email})`;
      if (existing.length) return res.status(400).json({ error: 'Email already exists' });
      await sql`
        INSERT INTO admins (id, name, email, password_hash)
        VALUES (${newId('adm_')}, ${name}, ${email}, ${hashPassword(pwd)})
      `;
      return res.status(200).json({ ok: true, msg: 'Admin account created.' });
    }

    return res.status(400).json({ error: 'Invalid role' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
