import sql from './db.js';
import { getSession, hashPassword, newId, str, EMAIL_RE } from './auth.js';
import { batchYear } from './sections.js';

const MIN_PW = 8;

async function resolveSection(section, dept, year) {
  if (!section) return null;
  try {
    const [byId] = await sql`SELECT id FROM sections WHERE id = ${section} LIMIT 1`;
    if (byId) return byId.id;
    // Student signup sends a section letter ("A"); match "A", "Section A", "CSE A", ...
    // only inside the student's own department and admission batch, since every
    // department has an "A" in every batch.
    const [byName] = await sql`
      SELECT s.id FROM sections s
      JOIN departments d ON d.id = s.department_id
      WHERE upper(d.code) = upper(${dept || ''})
        AND (${year}::int IS NULL OR s.batch_year = ${year})
        AND (s.name ILIKE ${section} OR s.name ILIKE ${'Section ' + section} OR s.name ILIKE ${'% ' + section})
      ORDER BY s.batch_year DESC NULLS LAST
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

      // Self-signup: only a student already on the roster (imported by an admin)
      // can create an account, by proving their reg. no. and roll no.
      if (!isAdmin) {
        if (!reg) return res.status(400).json({ error: 'Enter your registration number' });
        if (!roll) return res.status(400).json({ error: 'Enter your roll number' });
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
        if (pwd.length < MIN_PW) return res.status(400).json({ error: `Password must be at least ${MIN_PW} characters` });

        const [row] = await sql`SELECT reg_no, roll_no, password_hash FROM students WHERE upper(reg_no) = upper(${reg}) AND status = 'active'`;
        if (!row) return res.status(404).json({ error: 'This registration number is not on the class roster. Check it against your student ID, or ask your department admin to add you.' });
        if (row.password_hash) return res.status(409).json({ error: 'This registration number already has an account. Log in instead.' });
        if (String(row.roll_no).toUpperCase() !== roll.toUpperCase()) {
          return res.status(400).json({ error: 'That roll number does not match the roster for this registration number.' });
        }
        const [taken] = await sql`SELECT 1 AS x FROM students WHERE lower(email) = lower(${email}) AND reg_no <> ${row.reg_no}`;
        if (taken) return res.status(409).json({ error: 'That email is already used by another account.' });

        await sql`UPDATE students SET email = ${email}, password_hash = ${hashPassword(pwd)} WHERE reg_no = ${row.reg_no}`;
        return res.status(200).json({ ok: true, msg: 'Account created. You can log in now.' });
      }

      // Admin roster import: creates the roster entry (no password yet).
      if (!reg || !roll || !name) return res.status(400).json({ error: 'Name, registration no. and roll no. are required' });
      // Admission year: form/roster "year" (25 or 2025), else from a roll no. like CSE-25-101.
      let year = batchYear(b.year);
      if (!year) year = batchYear((roll.match(/-(\d{2}|\d{4})-/) || [])[1]);
      const sectionId = await resolveSection(section, dept, Number.isNaN(year) ? null : year);

      const existing = await sql`
        SELECT reg_no, roll_no, password_hash FROM students
        WHERE reg_no = ${reg} OR roll_no = ${roll} OR (${email} <> '' AND lower(email) = lower(${email}))
      `;

      if (existing.length) return res.status(400).json({ error: 'Registration no., roll no., or email already exists' });

      await sql`
        INSERT INTO students (reg_no, name, roll_no, dept, email, email_verified, status, section_id, password_hash, created_at)
        VALUES (${reg}, ${name}, ${roll}, ${dept}, ${email || null}, false, 'active', ${sectionId},
                ${null}, NOW())
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
