import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { subject_id, title, overview, requirements, total_marks, deadline } = req.body;
    const id = 't' + Date.now() + Math.random().toString(36).slice(2, 7);
    await sql`
      INSERT INTO topics (id, subject_id, title, overview, requirements, total_marks, deadline, created_at)
      VALUES (${id}, ${subject_id}, ${title}, ${overview}, ${requirements}, ${total_marks}, ${deadline || null}, NOW())
    `;
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
