import sql from './db.js';
import { requireRole, newId, str, ALLOWED_EXT, MAX_UPLOAD_BYTES } from './auth.js';

// feedback may come back as a JSON string when the column is text; normalise it.
export function safeFeedback(value) {
  if (typeof value !== 'string') return Array.isArray(value) ? value : (value ?? []);
  try { return JSON.parse(value || '[]'); } catch { return []; }
}

// Publish enforcement: students never see marks, feedback or similarity data
// until the teacher has published the submission. AI marks are never shown.
function forStudent(r) {
  const pub = !!r.published;
  return {
    ...r,
    ai_marks: null,
    similarity_group: null,
    similarity_pct: null,
    teacher_marks: pub ? r.teacher_marks : null,
    feedback: pub ? safeFeedback(r.feedback) : [],
  };
}

// Uploaded files must live in this student's folder on Vercel Blob (see upload.js).
export const studentPrefix = reg => `submissions/${encodeURIComponent(reg)}/`;

function validBlobUrl(url, reg) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:'
      && u.hostname.endsWith('.blob.vercel-storage.com')
      && decodeURIComponent(u.pathname.slice(1)).startsWith(studentPrefix(reg));
  } catch { return false; }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const session = await requireRole(req, res);
      if (!session) return;
      const isStudent = session.user_type === 'student';
      // Students can only ever read their own submissions.
      const regNo = isStudent ? session.user_id : req.query.reg_no;
      if (!regNo) return res.status(400).json({ error: 'reg_no required' });

      const rows = await sql`
        SELECT s.*, t.title as topic_title, sub.name as subject_name
        FROM submissions s
        LEFT JOIN topics t ON s.topic_id = t.id
        LEFT JOIN subjects sub ON s.subject_id = sub.id
        WHERE s.reg_no = ${regNo}
        ORDER BY s.submitted_at DESC
      `;
      const out = isStudent ? rows.map(forStudent) : rows.map(r => ({ ...r, feedback: safeFeedback(r.feedback) }));
      return res.status(200).json({ ok: true, submissions: out });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const session = await requireRole(req, res, ['student']);
    if (!session) return;

    const b = req.body;
    const subjectId = b.subject_id;
    const topicId = b.topic_id ?? b.topicId ?? null;
    const topicType = (b.topic_type ?? b.topicType) === 'custom' ? 'custom' : 'teacher';
    const fileName = str(b.file_name, 255);
    const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
    const sizeKb = Number(b.size_kb);

    if (!subjectId) return res.status(400).json({ error: 'subject_id required' });
    if (!topicId) return res.status(400).json({ error: 'topic_id required' });
    if (!ALLOWED_EXT.includes(ext)) return res.status(400).json({ error: 'File type not allowed' });
    if (!Number.isFinite(sizeKb) || sizeKb < 0 || sizeKb * 1024 > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'File exceeds 25MB limit' });
    }

    // Identity comes from the database, not from what the browser typed in.
    const [student] = await sql`SELECT reg_no, name, roll_no, dept FROM students WHERE reg_no = ${session.user_id}`;
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!validBlobUrl(b.file_url, student.reg_no)) return res.status(400).json({ error: 'Invalid file_url' });

    // The subject must belong to one of the student's sections.
    const [allowed] = await sql`
      SELECT 1 AS ok FROM subjects WHERE id = ${subjectId} AND section_id IN (
        SELECT section_id FROM students WHERE reg_no = ${student.reg_no} AND section_id IS NOT NULL
        UNION SELECT section_id FROM enrollments WHERE student_reg_no = ${student.reg_no}
      )
    `;
    if (!allowed) return res.status(403).json({ error: 'You are not enrolled in this subject' });

    let late = false;
    if (topicType === 'custom') {
      const [ct] = await sql`
        SELECT id FROM custom_topics
        WHERE id = ${topicId} AND subject_id = ${subjectId} AND student_reg_no = ${student.reg_no}
      `;
      if (!ct) return res.status(400).json({ error: 'Custom topic not found' });
    } else {
      // Late flag is computed server-side from the topic deadline.
      const [t] = await sql`
        SELECT (deadline IS NOT NULL AND CURRENT_DATE > deadline) AS late
        FROM topics WHERE id = ${topicId} AND subject_id = ${subjectId}
      `;
      if (!t) return res.status(400).json({ error: 'Topic not found for this subject' });
      late = !!t.late;
    }

    const id = newId('s');
    await sql`
      INSERT INTO submissions (
        id, subject_id, topic_id, topic_type, student_name, roll_no, reg_no,
        dept, file_name, file_type, size_kb, file_url, submitted_at, late,
        ai_marks, teacher_marks, published, similarity_group, similarity_pct, feedback
      ) VALUES (
        ${id}, ${subjectId}, ${topicId}, ${topicType}, ${student.name}, ${student.roll_no}, ${student.reg_no},
        ${student.dept}, ${fileName}, ${ext}, ${Math.round(sizeKb)}, ${b.file_url}, NOW(), ${late},
        ${null}, ${null}, ${false}, ${null}, ${null}, ${'[]'}
      )
    `;
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
