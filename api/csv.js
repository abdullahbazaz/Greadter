import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject_id } = req.query;
    if (!subject_id) return res.status(400).json({ error: 'subject_id required' });

    const rows = await sql`
      SELECT s.*, st.title as topic_title
      FROM submissions s
      LEFT JOIN topics st ON s.topic_id = st.id
      WHERE s.subject_id = ${subject_id}
      ORDER BY s.student_name
    `;

    const csvHeader = "Name,Roll No,Registration No,Department,Topic,File,AI Marks,Teacher Marks,Published,Late\n";
    const csvRows = rows.map(r =>
      `"${r.student_name}","${r.roll_no}","${r.reg_no}","${r.dept || ""}","${r.topic_title || ""}","${r.file_name}","${r.ai_marks || ""}","${r.teacher_marks || ""}","${r.published ? "yes" : "no"}","${r.late ? "late" : "on-time"}"
    `).join("\n");

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="subject_${subject_id}_marks.csv"`);
    return res.status(200).send(csvHeader + csvRows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
