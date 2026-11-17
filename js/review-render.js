// Teacher-side helpers for AI check results (db/ai_review.md). No DOM access.
// Requires esc() from js/auth.js.

// Thresholds for raising a flag in lists: prompts for a teacher to look, never a verdict.
// Each teacher can change them (saved to their account via /api/settings).
const FLAG_DEFAULTS = { ai_text: 50, similarity: 30 };
const FLAGS = { ...FLAG_DEFAULTS };
function setFlagThresholds(s){
  ["ai_text", "similarity"].forEach(k=>{
    const v = s && Number(s[k]);
    FLAGS[k] = Number.isInteger(v) && v >= 1 && v <= 100 ? v : FLAG_DEFAULTS[k];
  });
}

// An AI check that has said "processing" for this long almost certainly died with its server.
const STUCK_MS = 10 * 60 * 1000;

// Where a submission is in the marking process, for teacher-facing lists.
function reviewState(s){
  const r = s.ai_review || {}, st = r.status;
  if(s.published) return { key:"published", label:"Published, final", rank:5 };
  if(s.verified_at) return { key:"verified", label:"Verified, not published", rank:4 };
  if(st === "processing" && r.started_at && Date.now() - Date.parse(r.started_at) > STUCK_MS)
    return { key:"failed", label:"AI check stopped", rank:0 };
  if(st === "failed") return { key:"failed", label:"AI check failed", rank:0 };
  if(st === "done") return { key:"ready", label:"Ready to review", rank:1 };
  if(st === "processing" || st === "pending") return { key:"checking", label:"AI is checking", rank:3 };
  return { key:"manual", label:"Not checked yet", rank:2 };
}
const isPdf = s => String(s.file_type || "").toLowerCase() === "pdf";
// Can a teacher start an AI check on it right now?
const canRunAi = s => isPdf(s) && !s.published && reviewState(s).key !== "checking";

function reviewFlags(s){
  const r = s.ai_review || {};
  const ai = r.ai_text && Number.isFinite(+r.ai_text.likelihood) ? Math.round(+r.ai_text.likelihood) : null;
  const sims = Array.isArray(r.similarity) ? r.similarity.map(m=>+m.pct).filter(Number.isFinite) : [];
  const sim = sims.length ? Math.round(Math.max(...sims)) : (Number.isFinite(+s.similarity_pct) && s.similarity_pct != null ? Math.round(+s.similarity_pct) : null);
  return { ai, sim, aiFlag: ai != null && ai >= FLAGS.ai_text, simFlag: sim != null && sim >= FLAGS.similarity };
}

function flagTags(s){
  const f = reviewFlags(s), out = [];
  if(s.late) out.push(`<span class="tag late">late</span>`);
  if(f.aiFlag) out.push(`<span class="tag ai">${f.ai}% AI-like</span>`);
  if(f.simFlag) out.push(`<span class="tag sim">${f.sim}% similar</span>`);
  return out.join(" ");
}

function renderCriteria(review, total){
  const cs = review.criteria || [];
  const sug = review.suggested_marks;
  let h = `<p class="ai-mark"><span class="mark">${sug != null ? esc(sug) : "—"}</span>${total != null ? `<span class="small muted"> out of ${esc(total)}</span>` : ""}</p>`;
  if(cs.length){
    h += `<table class="criteria"><tr><th>Criterion</th><th>Marks</th></tr>` + cs.map(c=>
      `<tr><td>${esc(c.name)}${c.comment?`<br><span class="small muted">${esc(c.comment)}</span>`:""}</td><td class="num">${esc(c.marks ?? "—")}${c.out_of != null?` / ${esc(c.out_of)}`:""}</td></tr>`).join("") + `</table>`;
  }
  if(review.summary) h += `<p class="small">${esc(review.summary)}</p>`;
  return h;
}

// A likelihood bar. Worded as a likelihood because detectors are often wrong.
function renderAiText(review){
  const a = review.ai_text;
  if(!a || !Number.isFinite(+a.likelihood)) return `<p class="small muted">No AI-writing estimate for this submission.</p>`;
  const v = Math.max(0, Math.min(100, Math.round(+a.likelihood)));
  const n = (a.passages || []).length;
  return `<div class="meter" role="img" aria-label="${v}% likely to contain AI-written text"><span style="width:${v}%"></span></div>
    <p><b>${v}%</b> likely to contain AI-written text${n?`, in ${n} highlighted ${n === 1 ? "passage" : "passages"}`:""}.</p>
    ${a.reasons ? `<p class="small">${esc(a.reasons)}</p>` : ""}
    <p class="small muted">Detectors often flag genuine writing, especially by non-native English speakers. Treat this as a reason to look closer or talk to the student, not as proof.</p>`;
}

function renderSimilarity(review, others){
  const ms = review.similarity || [];
  if(!ms.length) return `<p class="small muted">No close matches with other students' work on this topic.</p>`;
  const byId = Object.fromEntries((others || []).map(o=>[o.id, o]));
  return `<ul class="matches">` + [...ms].sort((x, y)=>(+y.pct||0) - (+x.pct||0)).map(m=>{
    const o = byId[m.submission_id];
    const who = o ? `${esc(o.student_name)} <span class="small muted">roll ${esc(o.roll_no)}</span>` : `<span class="muted">another submission</span>`;
    const quotes = (m.passages || []).filter(p=>p.other_quote).slice(0, 2)
      .map(p=>`<blockquote class="small">${esc(p.other_quote)}</blockquote>`).join("");
    return `<li><p><b>${esc(Math.round(+m.pct || 0))}%</b> overlap with ${who}</p>${quotes}
      ${o?`<a class="small link" href="review.html?id=${encodeURIComponent(o.id)}">Open their submission</a>`:""}</li>`;
  }).join("") + `</ul>`;
}

// What the teacher sees about the AI check when there's no finished result.
function renderReviewStatus(s){
  const st = reviewState(s), r = s.ai_review || {};
  if(!isPdf(s)) return `<div class="alert">This file isn't a PDF, so it can't be checked or marked on the page. Download it and mark it yourself.</div>`;
  if(st.key === "checking") return `<div class="alert">The AI is checking this submission. It usually takes a minute or two.</div>`;
  if(st.key === "failed") return `<div class="alert bad">${st.label}${r.error?`: ${esc(r.error)}`:""}. Run it again, or mark the work yourself.</div>`;
  if(st.key === "manual") return `<div class="alert">Not checked yet. Run the AI check to get a suggested mark and the issues marked in red, or mark it yourself.</div>`;
  return "";
}
