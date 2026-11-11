import sql from './db.js';
import { requireRole, newId, str, STAFF, canAccessSubject, intOrNull } from './auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = v => (v ? String(v).slice(0, 10) : null);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (!(await requireRole(req, res))) return;
      const { subject_id } = req.query;
      // subject_id is optional: an empty value means "all subjects".
      const rows = subject_id
        ? await sql`SELECT * FROM topics WHERE subject_id = ${subject_id} ORDER BY title`
        : await sql`SELECT * FROM topics ORDER BY title`;
      return res.status(200).json({ ok: true, topics: rows });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const session = await requireRole(req, res, STAFF);
    if (!session) return;

    const b = req.body;
    const { id, action } = b;
    const has = key => Object.hasOwn(b, key);

    if (has('total_marks') && b.total_marks !== '' && b.total_marks != null && Number.isNaN(intOrNull(b.total_marks))) {
      return res.status(400).json({ error: 'total_marks must be a whole number' });
    }
    if (has('deadline') && b.deadline && !DATE_RE.test(dateOrNull(b.deadline))) {
      return res.status(400).json({ error: 'deadline must be YYYY-MM-DD' });
    }

    let existing = null;
    if (id) {
      [existing] = await sql`SELECT * FROM topics WHERE id = ${id}`;
      if (!existing) return res.status(404).json({ error: 'Topic not found' });
      if (!(await canAccessSubject(session, existing.subject_id))) return res.status(403).json({ error: 'Not your subject' });
    }

    if (action === 'delete') {
      if (!id) return res.status(400).json({ error: 'id required' });
      await sql`DELETE FROM topics WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    const targetSubject = has('subject_id') ? b.subject_id : existing?.subject_id;
    if (!targetSubject) return res.status(400).json({ error: 'subject_id required' });
    if ((!existing || targetSubject !== existing.subject_id) && !(await canAccessSubject(session, targetSubject))) {
      return res.status(403).json({ error: 'Not your subject' });
    }

    if (existing) {
      // Update: only overwrite the fields that were actually sent.
      const nextTitle = has('title') ? str(b.title, 200) : existing.title;
      if (!nextTitle) return res.status(400).json({ error: 'title required' });
      const nextMarks = has('total_marks') ? intOrNull(b.total_marks) : existing.total_marks;
      if (nextMarks == null) return res.status(400).json({ error: 'total_marks required' });

      await sql`
        UPDATE topics
        SET subject_id = ${targetSubject}, title = ${nextTitle},
            overview = ${has('overview') ? str(b.overview, 5000) : existing.overview},
            requirements = ${has('requirements') ? str(b.requirements, 5000) : existing.requirements},
            total_marks = ${nextMarks},
            deadline = ${has('deadline') ? dateOrNull(b.deadline) : existing.deadline}
        WHERE id = ${id}
      `;
      return res.status(200).json({ ok: true, id });
    }

    const title = str(b.title, 200);
    if (!title) return res.status(400).json({ error: 'title required' });
    const newTopicId = newId('t');
    await sql`
      INSERT INTO topics (id, subject_id, title, overview, requirements, total_marks, deadline, created_at)
      VALUES (${newTopicId}, ${targetSubject}, ${title}, ${str(b.overview, 5000)}, ${str(b.requirements, 5000)},
              ${intOrNull(b.total_marks) ?? 20}, ${dateOrNull(b.deadline)}, NOW())
    `;
    return res.status(200).json({ ok: true, id: newTopicId });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
