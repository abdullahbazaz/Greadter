import sql from './db.js';
import { requireRole, str } from './auth.js';

// Students join a section with its join code; admins can enroll anyone by section id.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res, ['student', 'admin']);
    if (!session) return;

    let regNo, sectionId;
    if (session.user_type === 'student') {
      const code = str(req.body.join_code, 40);
      if (!code) return res.status(400).json({ error: 'join_code required' });
      const [sec] = await sql`SELECT id FROM sections WHERE join_code = ${code}`;
      if (!sec) return res.status(404).json({ error: 'Invalid join code' });
      regNo = session.user_id;
      sectionId = sec.id;
    } else {
      regNo = str(req.body.reg_no, 60);
      sectionId = str(req.body.section_id, 60);
      if (!regNo || !sectionId) return res.status(400).json({ error: 'reg_no and section_id required' });
    }

    await sql`
      INSERT INTO enrollments (student_reg_no, section_id, joined_at)
      VALUES (${regNo}, ${sectionId}, NOW())
      ON CONFLICT (student_reg_no, section_id) DO NOTHING
    `;
    return res.status(200).json({ ok: true, section_id: sectionId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
