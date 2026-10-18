import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { subject_id } = req.query;
    if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
    try {
      const rows = await sql`
        SELECT s.*, st.title as topic_title
        FROM submissions s
        LEFT JOIN topics st ON s.topic_id = st.id
        WHERE s.subject_id = ${subject_id}
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
      const { id, published, teacher_marks, feedback } = req.body;
      await sql`
        UPDATE submissions
        SET published = ${published}, teacher_marks = ${teacher_marks || null}, feedback = ${JSON.stringify(feedback || [])}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}
