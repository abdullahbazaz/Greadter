import crypto from 'node:crypto';
import sql from './db.js';

export const STAFF = ['teacher', 'admin'];
export const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

// Cryptographically random identifiers (Date.now()/Math.random() are guessable).
export const newToken = () => crypto.randomBytes(32).toString('hex');
export const newId = prefix => prefix + crypto.randomBytes(9).toString('base64url');

// ---- passwords (scrypt, no extra dependency) ----
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (typeof pw !== 'string' || !pw || !stored) return false;
  if (stored.startsWith('scrypt$')) {
    const [, saltHex, hashHex] = stored.split('$');
    const expected = Buffer.from(hashHex || '', 'hex');
    if (!expected.length) return false;
    const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }
  // Legacy rows stored the password in plain text; compare in constant time
  // so login.js can upgrade them to a hash on the next successful login.
  const a = Buffer.from(pw), b = Buffer.from(String(stored));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const isLegacyHash = stored => !!stored && !String(stored).startsWith('scrypt$');

// ---- sessions ----
export function bearer(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export async function sessionFromToken(token) {
  if (!token || typeof token !== 'string') return null;
  // One query: session + teacher status, so deactivated teachers lose access immediately.
  const [s] = await sql`
    SELECT s.token, s.user_id, s.user_type, t.status AS teacher_status
    FROM sessions s
    LEFT JOIN teachers t ON s.user_type = 'teacher' AND t.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > NOW()
  `;
  if (!s) return null;
  if (s.user_type === 'teacher' && s.teacher_status !== 'active') return null;
  return s;
}

export const getSession = req => sessionFromToken(bearer(req));

// Sends 401/403 itself and returns null when the caller is not allowed.
export async function requireRole(req, res, roles) {
  const s = await getSession(req);
  if (!s) { res.status(401).json({ error: 'Not authenticated' }); return null; }
  if (roles && !roles.includes(s.user_type)) { res.status(403).json({ error: 'Forbidden' }); return null; }
  return s;
}

export const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'txt', 'odt', 'rtf'];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// ---- scoping (teachers only reach sections an admin assigned them) ----
export async function canAccessSection(session, sectionId) {
  if (session.user_type === 'admin') return true;
  if (session.user_type !== 'teacher' || !sectionId) return false;
  const [r] = await sql`SELECT 1 AS ok FROM section_teachers WHERE teacher_id = ${session.user_id} AND section_id = ${sectionId}`;
  return !!r;
}

export async function canAccessSubject(session, subjectId) {
  if (session.user_type === 'admin') return true;
  if (session.user_type !== 'teacher' || !subjectId) return false;
  const [r] = await sql`
    SELECT 1 AS ok FROM subjects s
    JOIN section_teachers st ON st.section_id = s.section_id
    WHERE s.id = ${subjectId} AND st.teacher_id = ${session.user_id}
  `;
  return !!r;
}

// Whole-number marks (schema columns are INTEGER). Returns null for blank, NaN for invalid.
export function intOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}
