import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM subjects ORDER BY name`;
      return res.status(200).json({ ok: true, subjects: rows });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { id, action, name, code, section_id, assignment_mode } = req.body;
      const has = key => Object.prototype.hasOwnProperty.call(req.body, key);

      if (action === 'delete') {
        if (!id) return res.status(400).json({ error: 'id required' });
        // Remove dependent rows first, ignoring tables that may not exist.
        const cleanups = [
          () => sql`DELETE FROM submissions WHERE subject_id = ${id}`,
          () => sql`DELETE FROM custom_topics WHERE subject_id = ${id}`,
          () => sql`DELETE FROM topics WHERE subject_id = ${id}`,
        ];
        for (const cleanup of cleanups) {
          try { await cleanup(); } catch (e) { console.error('subject cleanup:', e.message); }
        }
        await sql`DELETE FROM subjects WHERE id = ${id}`;
        return res.status(200).json({ ok: true });
      }

      if (id) {
        // Update: only overwrite the fields that were actually sent.
        const [existing] = await sql`SELECT * FROM subjects WHERE id = ${id}`;
        if (!existing) return res.status(404).json({ error: 'Subject not found' });

        const nextName = has('name') ? name : existing.name;
        const nextCode = has('code') ? code : existing.code;
        const nextSection = has('section_id') ? section_id : existing.section_id;
        const nextMode = has('assignment_mode') ? assignment_mode : existing.assignment_mode;

        await sql`
          UPDATE subjects
          SET name = ${nextName}, code = ${nextCode},
              section_id = ${nextSection ?? null},
              assignment_mode = ${nextMode || 'single'}
          WHERE id = ${id}
        `;
        return res.status(200).json({ ok: true, id });
      }

      if (!name) return res.status(400).json({ error: 'name required' });
      const newId = 'sub' + Date.now() + Math.random().toString(36).slice(2, 7);
      await sql`
        INSERT INTO subjects (id, name, code, section_id, assignment_mode, created_at)
        VALUES (${newId}, ${name}, ${code || null}, ${section_id || null}, ${assignment_mode || 'single'}, NOW())
      `;
      return res.status(200).json({ ok: true, id: newId });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
