import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, code, section_id, assignment_mode } = req.body;
    const id = 'sub' + Date.now() + Math.random().toString(36).slice(2, 7);
    await sql`
      INSERT INTO subjects (id, name, code, section_id, assignment_mode, created_at)
      VALUES (${id}, ${name}, ${code}, ${section_id}, ${assignment_mode || 'single'}, NOW())
    `;
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
