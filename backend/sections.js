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
      const { id, action, name, department_id, join_code } = req.body;
      const has = key => Object.prototype.hasOwnProperty.call(req.body, key);

      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'id required' });
        // Detach dependent rows first, ignoring tables that may not exist.
        const cleanups = [
          () => sql`DELETE FROM section_teachers WHERE section_id = ${id}`,
          () => sql`UPDATE students SET section_id = NULL WHERE section_id = ${id}`,
          () => sql`UPDATE subjects SET section_id = NULL WHERE section_id = ${id}`,
        ];
        for (const cleanup of cleanups) {
          try { await cleanup(); } catch (e) { console.error('section cleanup:', e.message); }
        }
        await sql`DELETE FROM sections WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      if (id) {
        // Update: only overwrite the fields that were actually sent.
        const [existing] = await sql`SELECT * FROM sections WHERE id = ${id}`;
        if (!existing) return res.status(404).json({ error: 'Section not found' });

        const nextName = has('name') ? name : existing.name;
        const nextDept = has('department_id') ? department_id : existing.department_id;
        const nextCode = has('join_code') ? join_code : existing.join_code;

        await sql`
          UPDATE sections
          SET name = ${nextName}, department_id = ${nextDept ?? null}, join_code = ${nextCode}
          WHERE id = ${id}
        `;
        return res.status(200).json({ ok: true, id });
      }

      if (!name) return res.status(400).json({ error: 'name required' });
      const newId = 'sec' + Date.now() + Math.random().toString(36).slice(2, 7);
      await sql`
        INSERT INTO sections (id, name, department_id, join_code, created_at)
        VALUES (${newId}, ${name}, ${department_id || null}, ${join_code || 'GC' + Date.now()}, NOW())
      `;
      return res.status(200).json({ ok: true, id: newId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
