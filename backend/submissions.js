import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { reg_no } = req.query;
    if (!reg_no) return res.status(400).json({ error: 'reg_no required' });
    try {
      const rows = await sql`
        SELECT s.*, t.title as topic_title, sub.name as subject_name
        FROM submissions s
        LEFT JOIN topics t ON s.topic_id = t.id
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.reg_no = ${reg_no}
        ORDER BY s.submitted_at DESC
      `;
      return res.status(200).json({ ok: true, submissions: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const {
        subject_id, topic_id, topic_type, student_name, roll_no, reg_no,
        dept, file_name, file_type, size_kb, submitted_at, late,
        ai_marks, teacher_marks, published, similarity_group, similarity_pct, feedback
      } = req.body;

      const id = 's' + Date.now() + Math.random().toString(36).slice(2, 7);
      await sql`
        INSERT INTO submissions (
          id, subject_id, topic_id, topic_type, student_name, roll_no, reg_no,
          dept, file_name, file_type, size_kb, submitted_at, late,
          ai_marks, teacher_marks, published, similarity_group, similarity_pct, feedback
        ) VALUES (
          ${id}, ${subject_id}, ${topic_id}, ${topic_type}, ${student_name}, ${roll_no}, ${reg_no},
          ${dept}, ${file_name}, ${file_type}, ${size_kb}, ${submitted_at}, ${late},
          ${ai_marks || null}, ${teacher_marks || null}, ${published || false},
          ${similarity_group || null}, ${similarity_pct || null}, ${JSON.stringify(feedback || [])}
        )
      `;
      return res.status(200).json({ ok: true, id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}
