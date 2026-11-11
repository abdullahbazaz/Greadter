import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { subject_id } = req.query;
  if (!subject_id) return res.status(400).json({ error: 'subject_id required' });

  try {
    const rows = await sql`SELECT * FROM topics WHERE subject_id = ${subject_id} ORDER BY title`;
    return res.status(200).json({ ok: true, topics: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
