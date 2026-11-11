import sql from './db.js';
import { requireRole, STAFF, canAccessSubject } from './auth.js';

// Quote every cell and neutralise spreadsheet formulas (CSV injection).
function cell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res, STAFF);
    if (!session) return;
    const { subject_id } = req.query;
    if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
    if (!(await canAccessSubject(session, subject_id))) return res.status(403).json({ error: 'Not your subject' });

    const rows = await sql`
      SELECT s.*, st.title as topic_title
      FROM submissions s
      LEFT JOIN topics st ON s.topic_id = st.id
      WHERE s.subject_id = ${subject_id}
      ORDER BY s.student_name
    `;

    const header = ['Name', 'Roll No', 'Registration No', 'Department', 'Topic', 'File',
      'AI Marks', 'Teacher Marks', 'Published', 'Late'].map(cell).join(',');
    const lines = rows.map(r => [
      r.student_name, r.roll_no, r.reg_no, r.dept, r.topic_title, r.file_name,
      r.ai_marks, r.teacher_marks, // ?? in cell(): a mark of 0 is kept, not blanked
      r.published ? 'yes' : 'no', r.late ? 'late' : 'on-time',
    ].map(cell).join(','));

    const safeName = String(subject_id).replace(/[^\w-]/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="subject_${safeName}_marks.csv"`);
    return res.status(200).send([header, ...lines].join('\r\n'));
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
