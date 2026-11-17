import sql from './db.js';
import { requireRole } from './auth.js';

// Student notices: "your mark is ready", "your mark was corrected".
// GET  /api/notifications            -> the student's unread notices (newest first)
// POST /api/notifications { ids:[] } -> mark those as read ({ all: true } marks every one)
// The same rows are the outbox for email: a future sender sends rows with emailed_at IS NULL.
export default async function handler(req, res) {
  try {
    const session = await requireRole(req, res, ['student']);
    if (!session) return;
    const reg = session.user_id;

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, submission_id, kind, message, created_at FROM notifications
        WHERE student_reg_no = ${reg} AND read_at IS NULL
        ORDER BY created_at DESC LIMIT 20
      `;
      return res.status(200).json({ ok: true, notifications: rows });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (req.body.all === true) {
      await sql`UPDATE notifications SET read_at = NOW() WHERE student_reg_no = ${reg} AND read_at IS NULL`;
    } else {
      const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).filter(x => typeof x === 'string').slice(0, 50);
      if (!ids.length) return res.status(400).json({ error: 'ids required' });
      // Scoped to this student, so nobody can dismiss someone else's notices.
      await sql`UPDATE notifications SET read_at = NOW() WHERE id = ANY(${ids}) AND student_reg_no = ${reg} AND read_at IS NULL`;
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
