// Issues marked on a submission's PDF. One shape for AI-found and teacher-added issues:
// {
//   id: "ai3" | "t1731…",
//   page: 1,                       // 1-based page number
//   kind: "text" | "region",       // highlighted text, or a box drawn around a diagram
//   category: "spelling" | "grammar" | "fact" | "logic" | "requirement" | "diagram" | "other",
//   quote: "exact text on the page",  // text issues; used to find the text on the page
//   location: "Paragraph 2, second sentence",  // where on the page, in words (works for scanned pages too)
//   note: "what's wrong",          // shown in the dropdown when the mark is clicked
//   suggestion: "how to fix it",
//   rects: [[x, y, w, h], …],      // position on the page as fractions of page width/height (0–1), top-left origin
//   fallback: [x, y, w, h],        // AI's approximate box, used when the quote can't be found on the page
//   approx: true,                  // the red mark came from the approximate box, not the exact words
//   source: "ai" | "teacher"
// }

export const CATEGORIES = ['spelling', 'grammar', 'fact', 'logic', 'requirement', 'diagram', 'other'];
const MAX_ISSUES = 200, MAX_RECTS = 40;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const frac = n => Number.isFinite(n) && n >= -0.01 && n <= 1.01;

function cleanRects(rects) {
  if (!Array.isArray(rects)) return [];
  return rects.slice(0, MAX_RECTS).filter(r => Array.isArray(r) && r.length === 4 && r.every(n => frac(Number(n))))
    .map(r => r.map(n => Math.round(Math.min(1, Math.max(0, Number(n))) * 10000) / 10000))
    .filter(([, , w, h]) => w > 0 && h > 0);
}

// Validates and trims whatever the browser or the AI sent. Drops anything unusable.
export function sanitizeAnnotations(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.slice(0, MAX_ISSUES).map((a, i) => {
    if (!a || typeof a !== 'object') return null;
    const page = Number(a.page);
    if (!Number.isInteger(page) || page < 1 || page > 2000) return null;
    let id = clean(a.id, 40).replace(/[^\w-]/g, '') || `x${i}`;
    while (seen.has(id)) id += '_';
    seen.add(id);
    const out = {
      id, page,
      kind: a.kind === 'region' ? 'region' : 'text',
      category: CATEGORIES.includes(a.category) ? a.category : 'other',
      quote: clean(a.quote, 500),
      location: clean(a.location, 200),
      note: clean(a.note, 2000),
      suggestion: clean(a.suggestion, 1000),
      rects: cleanRects(a.rects),
      source: a.source === 'ai' ? 'ai' : 'teacher',
    };
    const fb = cleanRects([a.fallback]);
    if (fb.length) out.fallback = fb[0];
    if (a.approx === true && out.rects.length) out.approx = true;
    return out.note || out.quote ? out : null;
  }).filter(Boolean);
}

// What a student receives: the same issues, without who found them.
export const forStudentAnnotations = list =>
  sanitizeAnnotations(list).map(({ source, ...a }) => a);
