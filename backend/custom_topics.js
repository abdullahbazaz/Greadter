import sql from './db.js';
import { requireRole, newId, str } from './auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res, ['student']);
    if (!session) return;

    const subjectId = req.body.subject_id;
    const title = str(req.body.title, 200);
    const summary = str(req.body.summary, 5000);
    if (!subjectId || !title || !summary) return res.status(400).json({ error: 'subject_id, title and summary required' });

    const [subject] = await sql`SELECT assignment_mode FROM subjects WHERE id = ${subjectId}`;
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    if (subject.assignment_mode !== 'custom') return res.status(400).json({ error: 'This subject does not allow custom topics' });

    const id = newId('ct');
    // student_reg_no comes from the session, never from the request body.
    await sql`
      INSERT INTO custom_topics (id, subject_id, student_reg_no, title, summary, created_at)
      VALUES (${id}, ${subjectId}, ${session.user_id}, ${title}, ${summary}, NOW())
    `;
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
