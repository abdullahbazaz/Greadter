import sql from './db.js';
import { requireRole, STAFF, canAccessSubject, intOrNull, str } from './auth.js';
import { safeFeedback } from './submissions.js';
import { sanitizeAnnotations } from './annotations.js';

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
               s.verified_at, s.corrections, s.ai_review - 'text' AS ai_review, jsonb_array_length(s.annotations) AS issue_count,
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

    // Bulk publish: { ids: [...], published: true }. Only verified submissions are released;
    // the rest are reported as skipped. Each student gets a notification.
    if (Array.isArray(b.ids)) {
      if (!has('published')) return res.status(400).json({ error: 'published required' });
      if (!b.published) return res.status(409).json({ error: "Published marks can't be unpublished. Open one and use \"Correct this mark\" to change it." });
      const ids = b.ids.filter(x => typeof x === 'string');
      if (!ids.length) return res.status(200).json({ ok: true, updated: 0, skipped: 0 });
      const rows = await sql`
        UPDATE submissions
        SET published = true
        WHERE id = ANY(${ids}) AND NOT published AND verified_at IS NOT NULL
          AND (${tid}::text IS NULL OR subject_id IN (
            SELECT sub.id FROM subjects sub JOIN section_teachers st ON st.section_id = sub.section_id
            WHERE st.teacher_id = ${tid}))
        RETURNING id
      `;
      if (rows.length) {
        await sql`
          INSERT INTO notifications (student_reg_no, submission_id, kind, message)
          SELECT s.reg_no, s.id, 'mark_published',
                 'Your mark for ' || COALESCE(t.title, ct.title, 'an assignment') || ' is ready.'
          FROM submissions s
          LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
          LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
          WHERE s.id = ANY(${rows.map(r => r.id)})
        `;
      }
      return res.status(200).json({ ok: true, updated: rows.length, skipped: ids.length - rows.length });
    }

    // Single submission: { id, teacher_marks?, feedback?, annotations?, verify?, published?, correction_reason? }
    const { id } = b;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!['teacher_marks', 'feedback', 'annotations', 'verify', 'published'].some(has)) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    const marksInput = has('teacher_marks') ? intOrNull(b.teacher_marks) : undefined;
    if (Number.isNaN(marksInput)) return res.status(400).json({ error: 'The mark must be a whole number' });

    const [existing] = await sql`
      SELECT s.*, t.total_marks, COALESCE(t.title, ct.title) AS topic_title FROM submissions s
      LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
      LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
      WHERE s.id = ${id}
    `;
    if (!existing) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canAccessSubject(session, existing.subject_id))) return res.status(403).json({ error: 'Not your subject' });

    // After publishing, changes are corrections: they need a reason the student will see,
    // the mark stays published, and every correction is kept in the history.
    const correcting = !!existing.published;
    const reason = str(b.correction_reason, 500);
    if (correcting) {
      if (!reason) return res.status(409).json({ error: 'This mark is published. To change it, use "Correct this mark" and give a reason.' });
      if (has('verify') || (has('published') && !b.published)) {
        return res.status(400).json({ error: "A published mark stays published. Change the mark, comment or issues as a correction instead." });
      }
    }

    const nextMarks = marksInput !== undefined ? marksInput : existing.teacher_marks;
    if (nextMarks != null && existing.total_marks != null && nextMarks > existing.total_marks) {
      return res.status(400).json({ error: `The mark can't be more than ${existing.total_marks}` });
    }

    // Verification is the teacher's sign-off on the mark. Un-verifying also unpublishes.
    let verifiedAt = existing.verified_at, verifiedBy = existing.verified_by;
    if (correcting) {
      if (nextMarks == null) return res.status(400).json({ error: 'A published mark needs a value' });
      verifiedAt = new Date().toISOString(); verifiedBy = session.user_id;   // the correction is a fresh sign-off
    } else if (has('verify')) {
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

    const nextAnnotations = has('annotations') ? sanitizeAnnotations(b.annotations) : sanitizeAnnotations(existing.annotations);

    // Record a correction (and refuse one that changes nothing).
    let corrections = Array.isArray(existing.corrections) ? existing.corrections : [];
    let notice = null;
    if (correcting) {
      const changed = [];
      if ((existing.teacher_marks ?? null) !== (nextMarks ?? null)) changed.push('mark');
      if (JSON.stringify(safeFeedback(existing.feedback)) !== JSON.stringify(nextFeedback)) changed.push('comment');
      if (JSON.stringify(sanitizeAnnotations(existing.annotations)) !== JSON.stringify(nextAnnotations)) changed.push('issues');
      if (!changed.length) return res.status(400).json({ error: "Nothing has changed yet, so there's no correction to save." });
      corrections = [...corrections, {
        at: verifiedAt, by: session.user_id, by_type: session.user_type,
        from_marks: existing.teacher_marks ?? null, to_marks: nextMarks, reason, changed,
      }].slice(-50);
      const what = existing.topic_title || 'an assignment';
      notice = { kind: 'mark_corrected', message: changed.includes('mark')
        ? `Your mark for ${what} was corrected from ${existing.teacher_marks} to ${nextMarks}.`
        : `Your teacher updated the feedback on ${what}.` };
    } else if (nextPublished && !existing.published) {
      notice = { kind: 'mark_published', message: `Your mark for ${existing.topic_title || 'an assignment'} is ready.` };
    }

    await sql`
      UPDATE submissions
      SET teacher_marks = ${nextMarks ?? null},
          feedback = ${JSON.stringify(nextFeedback)},
          annotations = ${JSON.stringify(nextAnnotations)},
          verified_at = ${verifiedAt}, verified_by = ${verifiedBy},
          published = ${nextPublished},
          corrections = ${JSON.stringify(corrections)}
      WHERE id = ${id}
    `;
    if (notice) {
      await sql`
        INSERT INTO notifications (student_reg_no, submission_id, kind, message)
        VALUES (${existing.reg_no}, ${id}, ${notice.kind}, ${notice.message})
      `;
    }
    return res.status(200).json({ ok: true, verified: !!verifiedAt, published: nextPublished, corrected: correcting });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
