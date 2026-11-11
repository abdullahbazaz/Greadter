import sql from './db.js';

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
        ? await sql`SELECT * FROM topics WHERE subject_id = ${subject_id} ORDER BY title`
        : await sql`SELECT * FROM topics ORDER BY title`;
      return res.status(200).json({ ok: true, topics: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { id, action, subject_id, title, overview, requirements, total_marks, deadline } = req.body;
      const has = key => Object.prototype.hasOwnProperty.call(req.body, key);

      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'id required' });
        // Detach submissions so the delete is not blocked by a foreign key.
        try { await sql`UPDATE submissions SET topic_id = NULL WHERE topic_id = ${id}`; } catch (e) { console.error('topic detach:', e.message); }
        await sql`DELETE FROM topics WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      if (id) {
        // Update: only overwrite the fields that were actually sent.
        const [existing] = await sql`SELECT * FROM topics WHERE id = ${id}`;
        if (!existing) return res.status(404).json({ error: 'Topic not found' });

        const nextSubject = has('subject_id') ? subject_id : existing.subject_id;
        const nextTitle = has('title') ? title : existing.title;
        const nextOverview = has('overview') ? overview : existing.overview;
        const nextReq = has('requirements') ? requirements : existing.requirements;
        const nextMarks = has('total_marks') ? total_marks : existing.total_marks;
        const nextDeadline = has('deadline') ? deadline : existing.deadline;

        await sql`
          UPDATE topics
          SET subject_id = ${nextSubject}, title = ${nextTitle},
              overview = ${nextOverview || ''}, requirements = ${nextReq || ''},
              total_marks = ${nextMarks ?? null}, deadline = ${nextDeadline || null}
          WHERE id = ${id}
        `;
        return res.status(200).json({ ok: true, id });
      }

      if (!subject_id) return res.status(400).json({ error: 'subject_id required' });
      if (!title) return res.status(400).json({ error: 'title required' });

      const newId = 't' + Date.now() + Math.random().toString(36).slice(2, 7);
      await sql`
        INSERT INTO topics (id, subject_id, title, overview, requirements, total_marks, deadline, created_at)
        VALUES (${newId}, ${subject_id}, ${title}, ${overview || ''}, ${requirements || ''}, ${total_marks ?? null}, ${deadline || null}, NOW())
      `;
      return res.status(200).json({ ok: true, id: newId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
