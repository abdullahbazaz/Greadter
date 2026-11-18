import sql from './db.js';
import { requireRole } from './auth.js';
import { aiLimits, AI_MODEL } from './ai.js';

// GET /api/ai_usage (admins): what AI checks have cost today and this month, who uses most,
// and the limits in force. Costs are estimates from list prices (backend/ai.js).
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!(await requireRole(req, res, ['admin']))) return;
    const [t] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW()))::int AS today_checks,
        COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0)::float AS today_cost,
        COUNT(*)::int AS month_checks,
        COALESCE(SUM(cost_usd), 0)::float AS month_cost,
        COUNT(*) FILTER (WHERE status = 'running' AND created_at > NOW() - INTERVAL '5 minutes')::int AS running
      FROM ai_usage WHERE created_at >= date_trunc('month', NOW())
    `;
    const top = await sql`
      SELECT u.staff_id, COALESCE(te.name, ad.name) AS name, COUNT(*)::int AS checks, COALESCE(SUM(u.cost_usd), 0)::float AS cost
      FROM ai_usage u
      LEFT JOIN teachers te ON u.staff_type = 'teacher' AND te.id = u.staff_id
      LEFT JOIN admins ad ON u.staff_type = 'admin' AND ad.id = u.staff_id
      WHERE u.created_at >= date_trunc('month', NOW())
      GROUP BY u.staff_id, te.name, ad.name
      ORDER BY cost DESC LIMIT 10
    `;
    return res.status(200).json({
      ok: true, model: AI_MODEL, limits: aiLimits(), running: t.running,
      today: { checks: t.today_checks, cost: t.today_cost },
      month: { checks: t.month_checks, cost: t.month_cost },
      top,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
