import sql from './db.js';
import { requireRole } from './auth.js';

// POST /api/settings { ai_text, similarity }: a teacher's own flag thresholds (whole %, 1-100).
// These only change which submissions are flagged in that teacher's lists; nothing student-facing.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res, ['teacher']);
    if (!session) return;

    const pct = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 100 ? n : null; };
    const aiText = pct(req.body.ai_text), similarity = pct(req.body.similarity);
    if (aiText == null || similarity == null) {
      return res.status(400).json({ error: 'Each threshold must be a whole number from 1 to 100' });
    }

    const settings = { ai_text: aiText, similarity };
    await sql`UPDATE teachers SET flag_settings = ${JSON.stringify(settings)} WHERE id = ${session.user_id}`;
    return res.status(200).json({ ok: true, flag_settings: settings });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
