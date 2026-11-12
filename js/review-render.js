// Pure rendering for AI review data (db/ai_review.md). No DOM access, so it can be
// tested outside a browser. Requires esc() from js/auth.js.

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

// Where a submission is in the marking process, for teacher-facing lists.
function reviewState(s){
  const st = s.ai_review && s.ai_review.status;
  if(s.published) return { key:"published", label:"Published", rank:5 };
  if(s.verified_at) return { key:"verified", label:"Verified, not published", rank:4 };
  if(st === "failed") return { key:"failed", label:"AI check failed", rank:0 };
  if(st === "done") return { key:"ready", label:"Ready to review", rank:1 };
  if(st === "pending" || st === "processing") return { key:"checking", label:"AI is checking", rank:3 };
  return { key:"manual", label:"Not checked by AI", rank:2 };
}

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

// Find where a span really is: trust offsets when they match the quote,
// otherwise fall back to searching for the quote. Returns null if it can't be placed.
function locate(text, item){
  const len = text.length;
  let a = Number.isInteger(item.start) ? item.start : -1, b = Number.isInteger(item.end) ? item.end : -1;
  const q = typeof item.quote === "string" ? item.quote : null;
  const offsetsOk = a >= 0 && b > a && b <= len;
  if(offsetsOk && (!q || text.slice(a, b) === q)) return [a, b];
  if(q){ const i = text.indexOf(q); if(i >= 0) return [i, i + q.length]; }
  return offsetsOk && !q ? [a, b] : null;
}

// Collect every highlight as [start, end, kind, number].
function collectSpans(review){
  const text = review.text || "", spans = [], unplaced = [];
  (review.mistakes || []).forEach((m, i)=>{
    const at = locate(text, m);
    if(at) spans.push({ a:at[0], b:at[1], kind:"mistake", n:i+1 }); else unplaced.push(i+1);
  });
  ((review.ai_text && review.ai_text.passages) || []).forEach(p=>{
    const at = locate(text, p); if(at) spans.push({ a:at[0], b:at[1], kind:"aitext" });
  });
  (review.similarity || []).forEach((m, mi)=>{
    (m.passages || []).forEach(p=>{
      const at = locate(text, p); if(at) spans.push({ a:at[0], b:at[1], kind:"match", match:mi });
    });
  });
  return { spans, unplaced };
}

// The submission as marked paper: overlapping highlights are split at every boundary,
// so each run of text carries all the kinds that cover it. Mistake numbers are written
// after the end of each underline, like a teacher's numbered correction.
function renderSheet(review){
  const text = review.text || "";
  const { spans, unplaced } = collectSpans(review);
  const cuts = new Set([0, text.length]);
  spans.forEach(s=>{ cuts.add(s.a); cuts.add(s.b); });
  const points = [...cuts].sort((x, y)=>x - y);
  let html = "";
  for(let i = 0; i < points.length - 1; i++){
    const a = points[i], b = points[i + 1];
    const on = spans.filter(s=>s.a <= a && s.b >= b);
    const chunk = esc(text.slice(a, b));
    if(!on.length){ html += chunk; }
    else {
      const kinds = [...new Set(on.map(s=>s.kind))];
      const nums = on.filter(s=>s.kind === "mistake").map(s=>s.n);
      html += `<span class="hl ${kinds.map(k=>"hl-" + k).join(" ")}"${nums.length?` data-m="${nums.join(" ")}"`:""}>${chunk}</span>`;
    }
    // Number each mistake where its underline ends.
    spans.filter(s=>s.kind === "mistake" && s.b === b).forEach(s=>{
      html += `<sup class="m-num" id="m-ref-${s.n}"><a href="#m-note-${s.n}" aria-label="Mistake ${s.n}">${s.n}</a></sup>`;
    });
  }
  return { html, unplaced };
}

const KIND_LABEL = { spelling:"Spelling", grammar:"Grammar", fact:"Fact", logic:"Reasoning", requirement:"Missed requirement" };

// Numbered notes beside the sheet, each with a "send to student" tick.
function renderMistakeNotes(review, chosen){
  const ms = review.mistakes || [];
  if(!ms.length) return `<p class="small muted">The AI found no mistakes to point out.</p>`;
  return `<ol class="notes">` + ms.map((m, i)=>{
    const n = i + 1;
    return `<li id="m-note-${n}" class="note-item">
      <span class="note-n" aria-hidden="true">${n}</span>
      <div>
        <p class="note-kind">${esc(KIND_LABEL[m.kind] || "Note")}${m.quote?`: <q>${esc(m.quote)}</q>`:""}</p>
        <p>${esc(m.note || "")}</p>
        ${m.suggestion?`<p class="small muted">Suggestion: ${esc(m.suggestion)}</p>`:""}
        <label class="tick"><input type="checkbox" data-share="${n}" ${chosen.has(n)?"checked":""}> Include in feedback to the student</label>
        <a class="small link" href="#m-ref-${n}">Show in text</a>
      </div>
    </li>`;
  }).join("") + `</ol>`;
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
  if(!a || !Number.isFinite(+a.likelihood)) return `<p class="small muted">No AI-writing check ran on this submission.</p>`;
  const v = Math.max(0, Math.min(100, Math.round(+a.likelihood)));
  const n = (a.passages || []).length;
  return `<div class="meter" role="img" aria-label="${v}% likely to contain AI-written text"><span style="width:${v}%"></span></div>
    <p><b>${v}%</b> likely to contain AI-written text${n?`, in ${n} highlighted ${n === 1 ? "passage" : "passages"}`:""}.</p>
    <p class="small muted">Detectors often flag genuine writing, especially by non-native English speakers. Treat this as a reason to look closer or talk to the student, not as proof.</p>`;
}

function renderSimilarity(review, others){
  const ms = review.similarity || [];
  if(!ms.length) return `<p class="small muted">No close matches with other students' work.</p>`;
  const byId = Object.fromEntries((others || []).map(o=>[o.id, o]));
  return `<ul class="matches">` + [...ms].sort((x, y)=>(+y.pct||0) - (+x.pct||0)).map(m=>{
    const o = byId[m.submission_id];
    const who = o ? `${esc(o.student_name)} <span class="small muted">roll ${esc(o.roll_no)}</span>` : `<span class="muted">Another submission</span>`;
    const quotes = (m.passages || []).filter(p=>p.other_quote).slice(0, 2)
      .map(p=>`<blockquote class="small">${esc(p.other_quote)}</blockquote>`).join("");
    return `<li><p><b>${esc(Math.round(+m.pct || 0))}%</b> overlap with ${who}</p>${quotes}
      ${o?`<a class="small link" href="review.html?id=${encodeURIComponent(o.id)}">Open their submission</a>`:""}</li>`;
  }).join("") + `</ul>`;
}

// What the teacher sees when there is no finished AI review.
function renderReviewStatus(review){
  const st = review && review.status;
  if(st === "pending" || st === "processing") return `<div class="alert">The AI is still checking this submission. Refresh in a minute, or mark it yourself from the downloaded file.</div>`;
  if(st === "failed") return `<div class="alert bad">The AI check failed${review.error?`: ${esc(review.error)}`:""}. Download the file and mark it yourself.</div>`;
  if(!review) return `<div class="alert">This submission hasn't been checked by AI. Download the file and mark it yourself.</div>`;
  return "";
}
