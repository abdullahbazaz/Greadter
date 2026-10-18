import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM sections ORDER BY name`;
      return res.status(200).json({ ok: true, sections: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, department_id, join_code } = req.body;
      const id = 'sec' + Date.now() + Math.random().toString(36).slice(2, 7);
      await sql`
        INSERT INTO sections (id, name, department_id, join_code, created_at)
        VALUES (${id}, ${name}, ${department_id}, ${join_code || 'GC' + Date.now()}, NOW())
      `;
      return res.status(200).json({ ok: true, id });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }
}
