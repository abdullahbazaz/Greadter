import { get } from '@vercel/blob';
import sql from './db.js';
import { requireRole, STAFF, canAccessSubject } from './auth.js';
import { runAiCheck, aiConfigured } from './ai.js';
import { PDFDocument } from 'pdf-lib';
import { sanitizeAnnotations } from './annotations.js';
import { MAX_PAGES } from './auth.js';

// New uploads are capped at 8 MB (auth.js); older ones could be larger, so read at most 10 MB.
const MAX_AI_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 300000;

async function readBlob(url) {
  const blob = await get(url, { access: 'private' });
  if (!blob || !blob.stream) throw new Error('The uploaded file could not be found.');
  const chunks = []; let size = 0;
  const reader = blob.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_AI_BYTES) throw new Error(`This PDF is too large for an AI check (over ${MAX_AI_BYTES / 1048576} MB). Mark it yourself.`);
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

// ---- similarity: plain text comparison, no AI ----
const words = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function shingles(text, n = 6) {
  const w = words(text), out = new Map();
  for (let i = 0; i + n <= w.length; i++) { const k = w.slice(i, i + n).join(' '); if (!out.has(k)) out.set(k, i); }
  return out;
}
// Share of the shorter text that also appears in the other, plus a few matching phrases as evidence.
function compare(a, b) {
  if (!a.size || !b.size) return null;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const shared = [...small.keys()].filter(k => large.has(k));
  const pct = Math.round(100 * shared.length / small.size);
  return { pct, quotes: shared.slice(0, 40).filter((_, i) => i % 13 === 0).slice(0, 3) };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = await requireRole(req, res, STAFF);
  if (!session) return;

  const id = typeof req.body.id === 'string' ? req.body.id : '';
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const [sub] = await sql`
      SELECT s.*, t.title AS topic_title, t.requirements, t.overview, t.total_marks, ct.title AS custom_title, ct.summary AS custom_summary
      FROM submissions s
      LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
      LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
      WHERE s.id = ${id}
    `;
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (!(await canAccessSubject(session, sub.subject_id))) return res.status(403).json({ error: 'Not your subject' });
    if (sub.published) return res.status(409).json({ error: 'This mark is published, so the AI check can no longer run on it. To change the mark, correct it on its review page.' });
    if (String(sub.file_type).toLowerCase() !== 'pdf' || !sub.file_url) {
      return res.status(400).json({ error: 'Only PDF submissions can be checked by AI. Download this file and mark it yourself.' });
    }
    if (!aiConfigured()) {
      return res.status(503).json({ error: "AI checks aren't set up yet. Add ANTHROPIC_API_KEY in the Vercel project settings." });
    }

    const startedAt = new Date().toISOString();
    await sql`UPDATE submissions SET ai_review = ${JSON.stringify({ status: 'processing', started_at: startedAt })} WHERE id = ${id}`;

    let result;
    try {
      const bytes = await readBlob(sub.file_url);
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error("This file isn't a valid PDF. Download it and mark it yourself.");
      let pages;
      try { pages = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount(); }
      catch { throw new Error("This PDF couldn't be opened (it may be damaged or password-protected). Download it and mark it yourself."); }
      if (pages > MAX_PAGES) throw new Error(`This PDF has ${pages} pages; AI checks cover up to ${MAX_PAGES}. Mark it yourself.`);
      const t0 = Date.now();
      result = await runAiCheck({
        pdfBase64: bytes.toString('base64'),
        topicTitle: sub.topic_title || sub.custom_title, requirements: sub.requirements, overview: sub.overview,
        customSummary: sub.topic_type === 'custom' ? sub.custom_summary : null, totalMarks: sub.total_marks,
      });
      result.pages = pages;
      result.durationMs = Date.now() - t0;
    } catch (e) {
      console.error('ai check:', e);
      const msg = (e && e.message) || 'The AI check failed.';
      await sql`UPDATE submissions SET ai_review = ${JSON.stringify({ status: 'failed', error: msg, started_at: startedAt })} WHERE id = ${id}`;
      return res.status(502).json({ error: msg });
    }

    const r = result.review;
    const total = sub.total_marks;
    const suggested = Number.isInteger(r.suggested_marks) ? Math.max(0, total != null ? Math.min(total, r.suggested_marks) : r.suggested_marks) : null;

    // AI issues become annotations; the teacher's own issues are kept, earlier AI ones are replaced.
    const aiIssues = sanitizeAnnotations((r.issues || []).map((x, i) => ({
      id: `ai${i + 1}`, page: x.page, kind: x.kind, category: x.category, quote: x.quote, location: x.location,
      note: x.note, suggestion: x.suggestion,
      // Diagram issues are placed by their box. Text issues are placed by finding the quote on the
      // page; their box (if any) is the fallback for scanned pages where the words can't be found.
      rects: x.kind === 'region' && x.region ? [[x.region.x, x.region.y, x.region.w, x.region.h]] : [],
      fallback: x.kind === 'text' && x.region ? [x.region.x, x.region.y, x.region.w, x.region.h] : undefined,
      source: 'ai',
    })));
    const keep = sanitizeAnnotations(sub.annotations).filter(a => a.source === 'teacher');

    // Similarity against other checked submissions on the same topic in the same subject.
    const text = typeof req.body.text === 'string' ? req.body.text.slice(0, MAX_TEXT) : '';
    const similarity = [];
    if (text) {
      const mine = shingles(text);
      const others = await sql`
        SELECT id, ai_review FROM submissions
        WHERE subject_id = ${sub.subject_id} AND topic_id = ${sub.topic_id} AND id <> ${id} AND reg_no <> ${sub.reg_no}
          AND ai_review ? 'text'
      `;
      for (const o of others) {
        const c = compare(mine, shingles(o.ai_review.text));
        if (!c || c.pct < 10) continue;
        similarity.push({ submission_id: o.id, pct: c.pct, passages: c.quotes.map(q => ({ other_quote: q })) });
        // Record the match on the other submission too, so both teachers' views agree.
        const theirs = (o.ai_review.similarity || []).filter(m => m.submission_id !== id);
        theirs.push({ submission_id: id, pct: c.pct, passages: c.quotes.map(q => ({ other_quote: q })) });
        const top = Math.max(...theirs.map(m => m.pct));
        await sql`UPDATE submissions SET ai_review = jsonb_set(ai_review, '{similarity}', ${JSON.stringify(theirs)}::jsonb), similarity_pct = ${top} WHERE id = ${o.id}`;
      }
    }

    const review = {
      status: 'done', checked_at: new Date().toISOString(), model: result.model,
      pages: result.pages, duration_ms: result.durationMs,   // to tune the time limit from real checks
      text: text || undefined,
      suggested_marks: suggested,
      criteria: Array.isArray(r.criteria) ? r.criteria.slice(0, 20) : [],
      summary: typeof r.summary === 'string' ? r.summary.slice(0, 3000) : '',
      ai_text: r.ai_text ? {
        likelihood: Math.max(0, Math.min(100, Math.round(+r.ai_text.likelihood || 0))),
        reasons: String(r.ai_text.reasons || '').slice(0, 1000),
        passages: (r.ai_text.passages || []).slice(0, 20),
      } : null,
      similarity,
    };
    const topSim = similarity.length ? Math.max(...similarity.map(m => m.pct)) : null;

    await sql`
      UPDATE submissions
      SET ai_review = ${JSON.stringify(review)}, ai_marks = ${suggested},
          similarity_pct = ${topSim}, annotations = ${JSON.stringify([...aiIssues, ...keep])}
      WHERE id = ${id}
    `;
    return res.status(200).json({ ok: true, issues: aiIssues.length, suggested_marks: suggested });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
}
