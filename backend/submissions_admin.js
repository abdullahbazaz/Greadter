import sql from './db.js';

// feedback may come back as a JSON string when the column is text; normalise it.
function safeFeedback(value) {
  if (typeof value !== 'string') return Array.isArray(value) ? value : (value ?? []);
  try { return JSON.parse(value || '[]'); } catch { return []; }
}
function normalise(rows) {
  return rows.map(r => ({ ...r, feedback: safeFeedback(r.feedback) }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { subject_id } = req.query;
    try {
      // subject_id is optional: an empty value means "all subjects".
      const rows = subject_id
        ? await sql`
            SELECT s.*, st.title as topic_title, sub.name as subject_name
            FROM submissions s
            LEFT JOIN topics st ON s.topic_id = st.id
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            WHERE s.subject_id = ${subject_id}
            ORDER BY s.submitted_at DESC
          `
        : await sql`
            SELECT s.*, st.title as topic_title, sub.name as subject_name
            FROM submissions s
            LEFT JOIN topics st ON s.topic_id = st.id
            LEFT JOIN subjects sub ON s.subject_id = sub.id
            ORDER BY s.submitted_at DESC
          `;
      return res.status(200).json({ ok: true, submissions: normalise(rows) });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });

      const has = key => Object.prototype.hasOwnProperty.call(req.body, key);
      if (!has('published') && !has('teacher_marks') && !has('feedback')) {
        return res.status(400).json({ error: 'Nothing to update' });
      }

      // Partial update: keep existing values for any field the caller omitted.
      const [existing] = await sql`SELECT * FROM submissions WHERE id = ${id}`;
      if (!existing) return res.status(404).json({ error: 'Submission not found' });

      const nextPublished = has('published') ? !!req.body.published : existing.published;
      const nextMarks = has('teacher_marks') ? req.body.teacher_marks : existing.teacher_marks;

      let nextFeedback = has('feedback') ? req.body.feedback : existing.feedback;
      if (typeof nextFeedback === 'string') {
        try { nextFeedback = JSON.parse(nextFeedback || '[]'); } catch { nextFeedback = []; }
      }
      if (!Array.isArray(nextFeedback)) nextFeedback = nextFeedback ? [nextFeedback] : [];

      await sql`
        UPDATE submissions
        SET published = ${nextPublished},
            teacher_marks = ${nextMarks ?? null},
            feedback = ${JSON.stringify(nextFeedback)}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}
