import { get } from '@vercel/blob';
import sql from './db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pathname } = req.query;
  if (!pathname) return res.status(400).json({ error: 'Missing pathname' });

  // Optional: verify the user is logged in / allowed
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  const [session] = await sql`SELECT * FROM sessions WHERE token = ${token} AND expires_at > NOW()`;
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  const blob = await get(pathname, { access: 'private' });
  if (!blob) return res.status(404).send('Not found');

  res.setHeader('Content-Type', blob.blob.contentType);
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  blob.stream.pipe(res);
}
