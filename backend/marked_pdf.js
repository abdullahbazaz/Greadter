import { get } from '@vercel/blob';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import sql from './db.js';
import { requireRole, canAccessSubject } from './auth.js';
import { sanitizeAnnotations } from './annotations.js';
import { safeFeedback } from './submissions.js';

const RED = rgb(0.702, 0.129, 0.169);   // the site's marking red, #B3212B
const INK = rgb(0, 0, 0), PENCIL = rgb(0.353, 0.325, 0.271);
const LABEL = { spelling: 'Spelling', grammar: 'Grammar', fact: 'Fact', logic: 'Reasoning', requirement: 'Missed requirement', diagram: 'Diagram', other: 'Note' };

// The standard PDF fonts only cover Latin-1; swap common typographic characters, mark the rest.
const latin1 = s => String(s || '')
  .replace(/[‘’‚]/g, "'").replace(/[“”„]/g, '"')
  .replace(/[–—−]/g, '-').replace(/…/g, '...').replace(/ /g, ' ')
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function wrap(text, font, size, width) {
  const out = [];
  for (const para of latin1(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      if (line) out.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {   // a single overlong word
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        out.push(line.slice(0, cut)); line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

// GET /api/marked_pdf?id=…  The student's PDF with the published issues marked in red,
// numbered, and listed with explanations on a "Teacher's notes" page at the end.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const session = await requireRole(req, res);
    if (!session) return;
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    const [sub] = await sql`
      SELECT s.*, COALESCE(t.title, ct.title) AS topic_title, t.total_marks, sub.name AS subject_name
      FROM submissions s
      LEFT JOIN topics t ON s.topic_type = 'teacher' AND s.topic_id = t.id
      LEFT JOIN custom_topics ct ON s.topic_type = 'custom' AND s.topic_id = ct.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE s.id = ${id}
    `;
    if (!sub || !sub.file_url) return res.status(404).json({ error: 'Not found' });
    if (session.user_type === 'student') {
      // Students only get it once the teacher has verified and published the mark.
      if (sub.reg_no !== session.user_id || !sub.published || !sub.verified_at) return res.status(404).json({ error: 'Not available yet' });
    } else if (!(await canAccessSubject(session, sub.subject_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (String(sub.file_type).toLowerCase() !== 'pdf') return res.status(400).json({ error: 'Only PDF submissions have a marked copy' });

    const blob = await get(sub.file_url, { access: 'private' });
    if (!blob || !blob.stream) return res.status(404).json({ error: 'Not found' });
    const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();
    const issues = sanitizeAnnotations(sub.annotations);

    // Red marks on the pages. Positions are fractions of the visible page (crop box), top-left origin.
    const pinCount = {};
    issues.forEach((a, i) => {
      const page = pages[a.page - 1];
      if (!page || page.getRotation().angle % 360 !== 0) return;
      if (!a.rects.length) {   // no position: a numbered pin along the top-right of its page
        const box = page.getCropBox(), k = pinCount[a.page] = (pinCount[a.page] || 0) + 1;
        const label = String(i + 1), r = 7, cx = box.x + box.width - 14 - (k - 1) * 17, cy = box.y + box.height - 14;
        page.drawCircle({ x: cx, y: cy, size: r, color: RED });
        page.drawText(label, { x: cx - bold.widthOfTextAtSize(label, 8) / 2, y: cy - 2.8, size: 8, font: bold, color: rgb(1, 1, 1) });
        return;
      }
      const box = page.getCropBox();
      a.rects.forEach(([x, y, w, h], j) => {
        const rx = box.x + x * box.width, ry = box.y + box.height - (y + h) * box.height;
        page.drawRectangle({ x: rx, y: ry, width: w * box.width, height: h * box.height,
          color: RED, opacity: a.kind === 'region' || a.approx ? 0.06 : 0.16, borderColor: RED, borderWidth: a.kind === 'region' || a.approx ? 1.5 : 0.6,
          borderOpacity: 0.9, borderDashArray: a.approx ? [4, 3] : undefined });
        if (j === 0) {   // the issue number, in a red circle at the start of the mark
          const label = String(i + 1), size = 8, r = 6.5;
          const cx = Math.max(box.x + r, rx - r - 1), cy = Math.min(box.y + box.height - r, ry + h * box.height + r - 1);
          page.drawCircle({ x: cx, y: cy, size: r, color: RED });
          page.drawText(label, { x: cx - bold.widthOfTextAtSize(label, size) / 2, y: cy - size * 0.35, size, font: bold, color: rgb(1, 1, 1) });
        }
      });
    });

    // The notes page(s): mark, comment, then each issue with its explanation.
    const W = 595.28, H = 841.89, M = 56, TW = W - 2 * M;
    let page = doc.addPage([W, H]), y = H - M;
    const line = (text, { f = font, size = 10.5, color = INK, gap = 4, indent = 0 } = {}) => {
      for (const l of wrap(text, f, size, TW - indent)) {
        if (y < M + size) { page = doc.addPage([W, H]); y = H - M; }
        page.drawText(l, { x: M + indent, y: y - size, size, font: f, color });
        y -= size + gap;
      }
    };
    line("Teacher's notes", { f: bold, size: 18, gap: 10 });
    line(`${sub.student_name}, roll ${sub.roll_no}`, { color: PENCIL });
    line(`${sub.subject_name || ''}${sub.topic_title ? `: ${sub.topic_title}` : ''}`, { color: PENCIL, gap: 14 });
    if (sub.published && sub.teacher_marks != null) line(`Mark: ${sub.teacher_marks}${sub.total_marks != null ? ` out of ${sub.total_marks}` : ''}`, { f: bold, size: 14, color: RED, gap: 12 });
    const corrections = Array.isArray(sub.corrections) ? sub.corrections : [];
    corrections.forEach(c => {
      const when = String(c.at || '').slice(0, 10);
      line(c.from_marks !== c.to_marks
        ? `Corrected ${when}: mark changed from ${c.from_marks} to ${c.to_marks}. Reason: ${c.reason}`
        : `Updated ${when}: ${(c.changed || []).join(' and ')} changed. Reason: ${c.reason}`, { color: PENCIL, gap: 4 });
    });
    if (corrections.length) y -= 8;
    const comment = (safeFeedback(sub.feedback).find(f => f.type === 'low') || {}).text;
    if (comment) { line('Comment', { f: bold, size: 12 }); line(comment, { gap: 4 }); y -= 10; }
    line(issues.length ? `Issues marked on your work (${issues.length})` : 'No issues were marked on this work.', { f: bold, size: 12, gap: 8 });
    issues.forEach((a, i) => {
      y -= 4;
      line(`${i + 1}. ${LABEL[a.category] || 'Note'}, page ${a.page}${a.location ? `, ${a.location}` : ''}${a.rects.length ? '' : ' (numbered at the top of the page)'}`, { f: bold, color: RED });
      if (a.quote && a.kind === 'text') line(`"${a.quote}"`, { color: PENCIL, indent: 14 });
      if (a.note) line(a.note, { indent: 14 });
      if (a.suggestion) line(`Suggestion: ${a.suggestion}`, { indent: 14, color: PENCIL });
    });

    const out = await doc.save();
    const name = String(sub.file_name || 'assignment.pdf').replace(/\.pdf$/i, '').replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name} - marked.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).send(Buffer.from(out));
  } catch (e) {
    console.error('marked pdf:', e);
    if (!res.headersSent) return res.status(500).json({ error: "Couldn't build the marked PDF. Download the original instead." });
  }
}

