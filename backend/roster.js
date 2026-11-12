import sql from './db.js';
import { str } from './auth.js';

// "Aisha Ansari" -> "A**** A*****": enough for a student to recognise themselves,
// not enough to turn reg. numbers into a name directory.
const mask = name => String(name || '').split(/\s+/).filter(Boolean)
  .map(w => w[0] + '*'.repeat(Math.max(w.length - 1, 2))).join(' ');

// POST /api/roster { reg_no } -> is this registration number on the roster, and is it free?
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const reg = str(req.body.reg_no, 60);
  if (!reg) return res.status(400).json({ error: 'Enter your registration number' });

  try {
    const [s] = await sql`
      SELECT st.reg_no, st.name, st.dept, st.password_hash IS NOT NULL AS claimed,
             sec.name AS section, sec.batch_year
      FROM students st
      LEFT JOIN sections sec ON sec.id = st.section_id
      WHERE upper(st.reg_no) = upper(${reg}) AND st.status = 'active'
    `;
    if (!s) {
      return res.status(404).json({ ok: false, found: false,
        error: 'This registration number is not on the class roster. Check it against your student ID, or ask your department admin to add you.' });
    }
    if (s.claimed) return res.status(200).json({ ok: true, found: true, claimed: true, reg_no: s.reg_no });
    return res.status(200).json({
      ok: true, found: true, claimed: false,
      reg_no: s.reg_no, masked_name: mask(s.name),
      dept: s.dept, section: s.section, batch_year: s.batch_year,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
