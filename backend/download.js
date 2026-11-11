import { get } from '@vercel/blob';
import { Readable } from 'node:stream';
import sql from './db.js';
import { requireRole, canAccessSubject } from './auth.js';

// GET /api/download?id=<submission id>
// The file is looked up from the database, so callers cannot ask for arbitrary blobs.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const session = await requireRole(req, res);
    if (!session) return;

    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id) return res.status(400).json({ error: 'id required' });
    const [sub] = await sql`SELECT reg_no, subject_id, file_url, file_name FROM submissions WHERE id = ${id}`;
    if (!sub || !sub.file_url) return res.status(404).json({ error: 'Not found' });

    // Students: own files only. Teachers: their subjects only. Admins: everything.
    const allowed = session.user_type === 'student'
      ? sub.reg_no === session.user_id
      : await canAccessSubject(session, sub.subject_id);
    if (!allowed) return res.status(403).json({ error: 'Forbidden' });

    const blob = await get(sub.file_url, { access: 'private' });
    if (!blob || !blob.stream) return res.status(404).json({ error: 'Not found' });

    const fileName = String(sub.file_name || 'submission').replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Type', blob.blob.contentType || 'application/octet-stream');
    // Always download, never render: an uploaded HTML/SVG file must not run on our origin.
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');

    const stream = typeof blob.stream.pipe === 'function' ? blob.stream : Readable.fromWeb(blob.stream);
    stream.on('error', e => { console.error('download stream:', e); res.destroy(e); });
    stream.pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) return res.status(500).json({ error: 'Server error' });
  }
}
