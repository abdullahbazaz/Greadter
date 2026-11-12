import sql from './db.js';
import { requireRole, STAFF, canAccessSubject, intOrNull } from './auth.js';
import { safeFeedback } from './submissions.js';

const normalise = rows => rows.map(r => ({ ...r, feedback: safeFeedback(r.feedback) }));

// Teachers and admins only. Students never reach this endpoint (requireRole below),
// which is what keeps AI output, similarity and AI-text flags away from them.
export default async function handler(req, res) {
  try {
    const session = await requireRole(req, res, STAFF);
    if (!session) return;
    const isAdmin = session.user_type === 'admin';
    // Admins see every subject; teachers only subjects in sections assigned to them.
    const tid = isAdmin ? null : session.user_id;

    if (req.method === 'GET') {
      // One submission with everything the review page needs.
      if (req.query.id) {
        const [row] = await sql`
          SELECT s.*, COALESCE(t.title, ct.title) AS topic_title, t.total_marks, t.requirements, t.overview,
                 ct.summary AS custom_summary, sub.name AS subject_name
          FROM submissions s
          LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
          LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
          JOIN subjects sub ON s.subject_id = sub.id
          WHERE s.id = ${req.query.id}
        `;
        if (!row) return res.status(404).json({ error: 'Submission not found' });
        if (!(await canAccessSubject(session, row.subject_id))) return res.status(403).json({ error: 'Not your subject' });

        // Name the other students in similarity matches (same subject, so same scope).
        const matchIds = (row.ai_review?.similarity || []).map(m => m.submission_id).filter(x => typeof x === 'string');
        let others = [];
        if (matchIds.length) {
          others = await sql`SELECT id, student_name, roll_no, file_name FROM submissions WHERE id = ANY(${matchIds}) AND subject_id = ${row.subject_id}`;
        }
        return res.status(200).json({ ok: true, submission: normalise([row])[0], others });
      }

      // List: the extracted text is left out (it can be long); the review page loads it.
      const subjectId = req.query.subject_id || null;
      const rows = await sql`
        SELECT s.id, s.subject_id, s.topic_id, s.topic_type, s.student_name, s.roll_no, s.reg_no, s.dept,
               s.file_name, s.file_type, s.size_kb, s.file_url, s.submitted_at, s.late,
               s.ai_marks, s.teacher_marks, s.published, s.similarity_group, s.similarity_pct, s.feedback,
               s.verified_at, s.ai_review - 'text' AS ai_review,
               COALESCE(st.title, ct.title) AS topic_title, st.total_marks, sub.name AS subject_name
        FROM submissions s
        LEFT JOIN topics st ON s.topic_type = 'teacher' AND s.topic_id = st.id
        LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
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

    // Bulk publish / unpublish: { ids: [...], published: bool }.
    // Publishing only releases verified submissions; the rest are reported as skipped.
    if (Array.isArray(b.ids)) {
      if (!has('published')) return res.status(400).json({ error: 'published required' });
      const ids = b.ids.filter(x => typeof x === 'string');
      if (!ids.length) return res.status(200).json({ ok: true, updated: 0, skipped: 0 });
      const rows = await sql`
        UPDATE submissions
        SET published = ${!!b.published}
        WHERE id = ANY(${ids})
          AND (${!b.published} OR verified_at IS NOT NULL)
          AND (${tid}::text IS NULL OR subject_id IN (
            SELECT sub.id FROM subjects sub JOIN section_teachers st ON st.section_id = sub.section_id
            WHERE st.teacher_id = ${tid}))
        RETURNING id
      `;
      return res.status(200).json({ ok: true, updated: rows.length, skipped: ids.length - rows.length });
    }

    // Single submission: { id, teacher_marks?, feedback?, verify?, published? }
    const { id } = b;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!['teacher_marks', 'feedback', 'verify', 'published'].some(has)) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const marksInput = has('teacher_marks') ? intOrNull(b.teacher_marks) : undefined;
    if (Number.isNaN(marksInput)) return res.status(400).json({ error: 'The mark must be a whole number' });

    const [existing] = await sql`
      SELECT s.*, t.total_marks FROM submissions s
      LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
      WHERE s.id = ${id}
    `;
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canAccessSubject(session, existing.subject_id))) return res.status(403).json({ error: 'Not your subject' });

    const nextMarks = marksInput !== undefined ? marksInput : existing.teacher_marks;
    if (nextMarks != null && existing.total_marks != null && nextMarks > existing.total_marks) {
      return res.status(400).json({ error: `The mark can't be more than ${existing.total_marks}` });
    }

    // Verification is the teacher's sign-off on the mark. Un-verifying also unpublishes.
    let verifiedAt = existing.verified_at, verifiedBy = existing.verified_by;
    if (has('verify')) {
      if (b.verify) {
        if (nextMarks == null) return res.status(400).json({ error: 'Set a mark before verifying' });
        verifiedAt = new Date().toISOString(); verifiedBy = session.user_id;
      } else {
        verifiedAt = null; verifiedBy = null;
      }
    }
    let nextPublished = has('published') ? !!b.published : existing.published;
    if (!verifiedAt) nextPublished = false;
    if (has('published') && b.published && !verifiedAt) {
      return res.status(400).json({ error: 'Verify the mark before publishing it' });
    }

    let nextFeedback = safeFeedback(has('feedback') ? b.feedback : existing.feedback);
    if (!Array.isArray(nextFeedback)) nextFeedback = [nextFeedback];
    // Feedback items are plain text the student will read; keep only the known fields.
    nextFeedback = nextFeedback.slice(0, 50).map(f => ({
      type: ['wrong', 'low', 'ok'].includes(f?.type) ? f.type : 'wrong',
      text: String(f?.text ?? '').slice(0, 2000),
      why: f?.why ? String(f.why).slice(0, 2000) : undefined,
    })).filter(f => f.text);

    await sql`
      UPDATE submissions
      SET teacher_marks = ${nextMarks ?? null},
          feedback = ${JSON.stringify(nextFeedback)},
          verified_at = ${verifiedAt}, verified_by = ${verifiedBy},
          published = ${nextPublished}
      WHERE id = ${id}
    `;
    return res.status(200).json({ ok: true, verified: !!verifiedAt, published: nextPublished });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
