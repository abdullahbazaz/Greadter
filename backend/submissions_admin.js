import sql from './db.js';
import { requireRole, STAFF, canAccessSubject, intOrNull } from './auth.js';
import { safeFeedback } from './submissions.js';

const normalise = rows => rows.map(r => ({ ...r, feedback: safeFeedback(r.feedback) }));

export default async function handler(req, res) {
  try {
    const session = await requireRole(req, res, STAFF);
    if (!session) return;
    const isAdmin = session.user_type === 'admin';
    // Admins see every subject; teachers only subjects in sections assigned to them.
    const tid = isAdmin ? null : session.user_id;

    if (req.method === 'GET') {
      const subjectId = req.query.subject_id || null;
      const rows = await sql`
        SELECT s.*, st.title as topic_title, st.total_marks, sub.name as subject_name
        FROM submissions s
        LEFT JOIN topics st ON s.topic_id = st.id
        JOIN subjects sub ON s.subject_id = sub.id
        WHERE (${subjectId}::text IS NULL OR s.subject_id = ${subjectId})
          AND (${tid}::text IS NULL OR sub.section_id IN (SELECT section_id FROM section_teachers WHERE teacher_id = ${tid}))
        ORDER BY s.submitted_at DESC
      `;
      return res.status(200).json({ ok: true, submissions: normalise(rows) });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const b = req.body;
    const has = key => Object.hasOwn(b, key);

    // Bulk publish / unpublish in a single query: { ids: [...], published: bool }.
    if (Array.isArray(b.ids)) {
      if (!has('published')) return res.status(400).json({ error: 'published required' });
      const ids = b.ids.filter(x => typeof x === 'string');
      if (!ids.length) return res.status(200).json({ ok: true, updated: 0 });
      const rows = await sql`
        UPDATE submissions
        SET published = ${!!b.published},
            teacher_marks = CASE WHEN ${!!b.published} THEN COALESCE(teacher_marks, ai_marks) ELSE teacher_marks END
        WHERE id = ANY(${ids})
          AND (${tid}::text IS NULL OR subject_id IN (
            SELECT sub.id FROM subjects sub JOIN section_teachers st ON st.section_id = sub.section_id
            WHERE st.teacher_id = ${tid}))
        RETURNING id
      `;
      return res.status(200).json({ ok: true, updated: rows.length });
    }

    const { id } = b;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!has('published') && !has('teacher_marks') && !has('feedback')) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const marksInput = has('teacher_marks') ? intOrNull(b.teacher_marks) : undefined;
    if (Number.isNaN(marksInput)) return res.status(400).json({ error: 'teacher_marks must be a whole number' });

    // Partial update: keep existing values for any field the caller omitted.
    const [existing] = await sql`SELECT * FROM submissions WHERE id = ${id}`;
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canAccessSubject(session, existing.subject_id))) return res.status(403).json({ error: 'Not your subject' });

    const nextPublished = has('published') ? !!b.published : existing.published;
    let nextMarks = marksInput !== undefined ? marksInput : existing.teacher_marks;
    // Publishing without a teacher override falls back to the AI mark.
    if (nextPublished && nextMarks == null) nextMarks = existing.ai_marks ?? null;
    const nextFeedback = safeFeedback(has('feedback') ? b.feedback : existing.feedback);

    await sql`
      UPDATE submissions
      SET published = ${nextPublished},
          teacher_marks = ${nextMarks ?? null},
          feedback = ${JSON.stringify(Array.isArray(nextFeedback) ? nextFeedback : [nextFeedback])}
      WHERE id = ${id}
    `;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
