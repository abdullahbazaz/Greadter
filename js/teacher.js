// Teacher workspace — live API backend (Neon via Vercel). Requires js/auth.js.
const session = requirePageRole("teacher");
let checked = new Set();
let pendingDelete = null;
let allSubjects = [];
let allTopics = [];
let allSubmissions = [];
let mySections = [];
let scopeRestored = false;


async function init(){
  if(!session) return;
  const me = await api("/me");
  if(me && me.ok) setFlagThresholds(me.user.flag_settings);
  if(!me || !me.ok){ clearSession(); location.replace(LOGIN_PAGE.teacher); return; }
  await loadData();
}

// One parallel round-trip for everything; filters and search then run client-side.
async function loadData(){
  const [s, t, subs, sec] = await Promise.all([api("/subjects"), api("/topics"), api("/submissions_admin"), api("/sections")]);
  allSubjects = (s && s.subjects) || [];
  const subjectIds = new Set(allSubjects.map(x=>x.id));
  allTopics = ((t && t.topics) || []).filter(x=>subjectIds.has(x.subject_id));
  mySections = (sec && sec.sections) || [];
  if(!scopeRestored){
    scopeRestored = true;
    const saved = loadScope();
    fillClassSelect($("fSec"), "All my classes");
    if(saved.sec && mySections.some(x=>x.id===saved.sec)) $("fSec").value = saved.sec;
    if(saved.sub && allSubjects.some(x=>x.id===saved.sub && (!saved.sec || x.section_id===saved.sec))){
      const o = document.createElement("option"); o.value = saved.sub; $("fSub").appendChild(o); $("fSub").value = saved.sub;
    }
  }
  allSubmissions = (subs && subs.submissions) || [];
  const ids = new Set(allSubmissions.map(x=>x.id));
  checked = new Set([...checked].filter(id=>ids.has(id)));
  renderAll();
}

function renderAll(){ renderSubjects(); renderTopics(); renderSubs(); renderSim(); renderPublish(); renderThresholds(); renderTodo(); }
// Everything on the page follows the one subject picker at the top.
// Two levels of scope: a class (one of the teacher's sections, i.e. a semester) and a subject in it.
const subjectById = id => allSubjects.find(x=>x.id===id);
function subjectInScope(sub){
  if(!sub) return false;
  const fs = $("fSub").value, fc = $("fSec").value;
  if(fs) return sub.id === fs;
  return !fc || sub.section_id === fc;
}
// Works for submissions and topics (anything with subject_id) and for subjects themselves.
const inScope = x => subjectInScope(x.subject_id !== undefined ? subjectById(x.subject_id) : x);
const classOf = x => mySections.find(sec=>sec.id === (subjectById(x.subject_id) || x).section_id);

// Classes grouped by the semester they're in now; finished ones go last as "Past classes".
function fillClassSelect(sel, placeholder){
  const cur = sel.value;
  sel.innerHTML = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
  const groups = new Map();
  [...mySections].sort((a, b)=>(semesterOf(a.batch_year) ?? 99) - (semesterOf(b.batch_year) ?? 99) || sectionLabel(a).localeCompare(sectionLabel(b)))
    .forEach(sec=>{
      const sem = semesterOf(sec.batch_year);
      const g = sem == null ? "No admission year set" : sem > SEMESTERS ? "Past classes" : sem < 1 ? "Not started yet" : `Semester ${sem}`;
      if(!groups.has(g)) groups.set(g, []);
      groups.get(g).push(sec);
    });
  groups.forEach((list, g)=>{
    const og = document.createElement("optgroup"); og.label = g;
    list.forEach(sec=>{ const o = document.createElement("option"); o.value = sec.id; o.textContent = sectionLabel(sec); og.appendChild(o); });
    sel.appendChild(og);
  });
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}

// Remember the last class/subject on this device, so the dashboard opens where the teacher left it.
const SCOPE_KEY = "greadter_teacher_scope";
function saveScope(){ try{ localStorage.setItem(SCOPE_KEY, JSON.stringify({ sec:$("fSec").value, sub:$("fSub").value })); }catch(e){} }
function loadScope(){ try{ return JSON.parse(localStorage.getItem(SCOPE_KEY) || "{}") || {}; }catch(e){ return {}; } }

function fillSelect(sel, items, {placeholder, label=x=>x.name}={}){
  const cur = sel.value;
  sel.innerHTML = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
  items.forEach(x=>{ const o=document.createElement("option"); o.value=x.id; o.textContent=label(x); sel.appendChild(o); });
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}

// ---- subjects ----
function renderSubjects(){
  const box = $("subList"); box.innerHTML = "";
  const fc = $("fSec").value;
  let lastSec = null;
  [...allSubjects].filter(s=>!fc || s.section_id===fc)
    .sort((a, b)=>(semesterOf((classOf(a)||{}).batch_year) ?? 99) - (semesterOf((classOf(b)||{}).batch_year) ?? 99)
      || sectionLabel(classOf(a)).localeCompare(sectionLabel(classOf(b))) || a.name.localeCompare(b.name))
    .forEach(s=>{
    if(!fc && s.section_id !== lastSec){
      lastSec = s.section_id;
      const h = document.createElement("h4"); h.className = "topic-group"; h.textContent = sectionLabel(classOf(s)) || "Unknown class"; box.appendChild(h);
    }
    const n = allTopics.filter(t=>t.subject_id===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline"; d.style.cursor = "default";
    const mode = { single:"everyone answers the same topic", multiple:"students choose a topic", custom:"students can propose a topic" }[s.assignment_mode || "single"];
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc([s.code, `${n} ${n===1?"topic":"topics"}`, mode].filter(Boolean).join(", "))}</span></span>
      <span><span class="toolbar" style="margin:0"><button class="linklike" data-act="ren">Rename</button><button class="linklike" data-act="del">Delete</button></span></span>`;
    d.querySelector('[data-act="ren"]').onclick = async ()=>{
      const v = prompt("New subject name:", s.name); if(!v || !v.trim()) return;
      const r = await api("/subjects", { method:"POST", body: JSON.stringify({ id: s.id, name: v.trim() }) });
      if(r && !r.ok) alert(r.error);
      await loadData();
    };
    d.querySelector('[data-act="del"]').onclick = ()=>{
      pendingDelete=s.id; $("delName").textContent=s.name; $("delInput").value=""; $("delConfirm").disabled=true; $("delModal").classList.add("show");
    };
    box.appendChild(d);
  });
  if(!mySections.length) box.innerHTML = `<div class="alert bad">No sections are assigned to you yet. Ask an admin to assign your sections.</div>`;
  else if(!box.children.length) box.innerHTML = `<div class="muted small">No subjects in ${fc ? "this class" : "your classes"} yet. Add one below.</div>`;
  fillClassSelect($("fSec"), "All my classes");
  fillClassSelect($("subSec"), mySections.length ? "Pick a class" : "No classes assigned");
  if(!$("subSec").value && fc) $("subSec").value = fc;
  // Subject picker only lists the chosen class's subjects; drop a subject that no longer fits.
  const classSubjects = allSubjects.filter(s=>!fc || s.section_id===fc);
  fillSelect($("fSub"), classSubjects, {placeholder: fc ? "All subjects in this class" : "All subjects", label: s=>fc ? s.name : `${s.name} (${sectionLabel(classOf(s))})`});
  fillSelect($("topicSub"), classSubjects, {placeholder: classSubjects.length ? "Pick a subject" : "Add a subject first", label: s=>fc ? s.name : `${s.name} (${sectionLabel(classOf(s))})`});
  if(!$("topicSub").value && $("fSub").value) $("topicSub").value = $("fSub").value;
  const nSub = classSubjects.length;
  $("cntSubj").textContent = nSub ? String(nSub) : "";
  $("scopeHint").textContent = mySections.length
    ? `You teach ${mySections.length} ${mySections.length===1?"class":"classes"}. Everything on this page follows these two choices.`
    : "No classes are assigned to you yet. Ask an admin to assign your sections.";
}

$("addSubBtn").onclick = async ()=>{
  const sec = $("subSec").value; if(!sec){ alert("Pick one of your sections"); return; }
  const n = $("subName").value.trim(); if(!n){ alert("Enter subject name"); return; }
  const r = await api("/subjects", { method:"POST", body: JSON.stringify({ name:n, code:$("subCode").value.trim(), section_id:sec, assignment_mode:$("subMode").value || "single" }) });
  if(r && !r.ok){ alert(r.error); return; }
  $("subName").value=""; $("subCode").value=""; await loadData();
};

$("delCancel").onclick = ()=>$("delModal").classList.remove("show");
$("delInput").oninput = e=>{ $("delConfirm").disabled = e.target.value.trim()!=="delete"; };
$("delConfirm").onclick = async ()=>{
  await api("/subjects", { method:"POST", body: JSON.stringify({ id: pendingDelete, action:"delete" }) });
  pendingDelete=null; $("delModal").classList.remove("show"); await loadData();
};

// ---- topics ----
function topicItem(t){
  const d = document.createElement("div");
  d.className = "topic";
  d.innerHTML = `<h4>${esc(t.title)}</h4>
    <p class="spec">${esc(t.total_marks ?? "—")} marks${t.deadline?`, due ${esc(fmtDate(t.deadline))}`:", no deadline"}</p>
    ${t.overview?`<p class="small">${esc(t.overview)}</p>`:""}
    ${t.requirements?`<p class="small muted">Requirements: ${esc(t.requirements)}</p>`:`<p class="small muted">No requirements written yet. The AI marks against them, so add some.</p>`}
    <div class="toolbar"><button class="linklike" data-a="e">Edit</button><button class="linklike" data-a="d">Delete</button></div>`;
  d.querySelector('[data-a="d"]').onclick = async ()=>{
    if(!confirm(`Delete topic "${t.title}"?`)) return;
    await api("/topics", { method:"POST", body: JSON.stringify({ id: t.id, action:"delete" }) });
    await loadData();
  };
  d.querySelector('[data-a="e"]').onclick = async ()=>{
    const upd = { id: t.id };
    const nt = prompt("Title:", t.title); if(nt === null) return; if(nt.trim()) upd.title = nt.trim();
    const nm = prompt("Total marks:", t.total_marks ?? ""); if(nm !== null && nm.trim() !== "") upd.total_marks = +nm;
    const nd = prompt("Deadline YYYY-MM-DD:", fmtDate(t.deadline)); if(nd !== null) upd.deadline = nd.trim() || null;
    const r = await api("/topics", { method:"POST", body: JSON.stringify(upd) });
    if(r && !r.ok) alert(r.error);
    await loadData();
  };
  return d;
}

function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const subs = allSubjects.filter(inScope);
  const shown = allTopics.filter(inScope);
  if(!allSubjects.length) box.innerHTML = `<p class="muted small">Add a subject first, then its topics.</p>`;
  else if(!shown.length) box.innerHTML = `<p class="muted small">No topics yet${$("fSub").value ? " for this subject" : $("fSec").value ? " in this class" : ""}. Add one below.</p>`;
  subs.forEach(sub=>{
    const list = shown.filter(t=>t.subject_id===sub.id);
    if(!list.length) return;
    const h = document.createElement("h4"); h.className = "topic-group";
    h.textContent = $("fSec").value ? sub.name : `${sub.name}, ${sectionLabel(classOf(sub))}`; box.appendChild(h);
    list.forEach(t=>box.appendChild(topicItem(t)));
  });
  $("cntTopic").textContent = shown.length ? String(shown.length) : "";
  fillSelect($("fTopic"), shown, {placeholder:"All topics", label:t=>t.title});
}

$("addTopicBtn").onclick = async ()=>{
  const sid = $("topicSub").value; if(!sid){ alert("Choose which subject this topic belongs to."); return; }
  const title = $("topicTitle").value.trim(); if(!title){ alert("Enter topic title"); return; }
  const r = await api("/topics", { method:"POST", body: JSON.stringify({ subject_id:sid, title, overview:$("topicOverview").value.trim(), requirements:$("topicReq").value.trim(), total_marks:+$("topicMarks").value||20, deadline:$("topicDeadline").value||null }) });
  if(r && !r.ok){ alert(r.error); return; }
  $("topicTitle").value=""; $("topicOverview").value=""; $("topicReq").value="";
  await loadData();
};

// ---- submissions to check ----
$("fSec").addEventListener("change", ()=>{ $("fSub").value = ""; $("fTopic").value = ""; saveScope(); renderAll(); });
$("fSub").addEventListener("change", ()=>{ if($("fSub").value) $("topicSub").value = $("fSub").value; $("fTopic").value = ""; saveScope(); renderAll(); });
$("fTopic").addEventListener("change", renderSubs);
$("fSearch").addEventListener("input", renderSubs);
$("fState").addEventListener("change", renderSubs);

const reviewLink = s => `review.html?id=${encodeURIComponent(s.id)}`;

function filteredSubs(){
  const ft = $("fTopic").value, fst = $("fState").value, q = $("fSearch").value.trim().toLowerCase();
  return allSubmissions.filter(s=>{
    const st = reviewState(s).key, f = reviewFlags(s);
    return inScope(s) && (!ft || s.topic_id===ft) &&
      (!q || `${s.student_name} ${s.roll_no} ${s.reg_no}`.toLowerCase().includes(q)) &&
      (!fst || (fst==="todo" && ["ready","failed","manual"].includes(st)) || (fst==="flagged" && (f.aiFlag || f.simFlag)) || fst===st);
  // Most urgent first: failed checks, then ready-to-review (flagged ones on top), then the rest.
  }).sort((x, y)=>{
    const rx = reviewState(x).rank, ry = reviewState(y).rank;
    if(rx !== ry) return rx - ry;
    const fx = reviewFlags(x), fy = reviewFlags(y);
    return (+(fy.aiFlag || fy.simFlag)) - (+(fx.aiFlag || fx.simFlag)) || String(y.submitted_at).localeCompare(String(x.submitted_at));
  });
}

function aiCell(s){
  const r = s.ai_review;
  if(r && r.status === "done" && r.suggested_marks != null) return `<span class="mark">${esc(r.suggested_marks)}</span>${s.total_marks!=null?`<span class="small muted"> / ${esc(s.total_marks)}</span>`:""}`;
  return `<span class="muted">—</span>`;
}

function renderSubs(){
  let h = `<tr><th></th><th>Student</th><th>Topic</th><th>AI's mark</th><th>Flags</th><th>Your mark</th><th>Status</th><th></th></tr>`;
  const rows = filteredSubs();
  rows.forEach(s=>{
    const st = reviewState(s);
    h += `<tr><td><input type="checkbox" data-id="${esc(s.id)}" ${checked.has(s.id)?"checked":""} aria-label="Select ${esc(s.student_name)}"></td>
      <td><b>${esc(s.student_name)}</b><br><span class="small muted">Roll ${esc(s.roll_no)}</span></td>
      <td>${esc(s.topic_title||"")}<br><span class="small muted">${esc(s.subject_name||"")}${$("fSec").value ? "" : `, ${esc(sectionLabel(classOf(s)))}`}<br>${esc(fmtTime(s.submitted_at))}</span></td>
      <td>${aiCell(s)}</td>
      <td>${flagTags(s) || '<span class="muted small">None</span>'}</td>
      <td>${s.teacher_marks!=null?`<b>${esc(s.teacher_marks)}</b>`:'<span class="muted">—</span>'}</td>
      <td><span class="state-chip state-${st.key}">${esc(st.label)}</span></td>
      <td><a class="btn small ${st.key==="ready"?"primary":""}" href="${reviewLink(s)}">${st.key==="ready"||st.key==="manual"||st.key==="failed"?"Review":"Open"}</a></td></tr>`;
  });
  if(!rows.length) h += `<tr><td colspan="8" class="muted small">${allSubmissions.length ? "No submissions match these filters." : "No submissions yet. They appear here when students upload work."}</td></tr>`;
  const tbl = $("subTable"); tbl.innerHTML = h;
  tbl.querySelectorAll('input[type="checkbox"]').forEach(c=>c.onchange=()=>{ c.checked?checked.add(c.dataset.id):checked.delete(c.dataset.id); $("selCount").textContent = checked.size+" selected"; });
  $("selCount").textContent = checked.size+" selected";
}

// ---- what needs doing: plain sentences that jump to the matching work ----
function renderTodo(){
  const rows = allSubmissions.filter(inScope);
  const count = fn => rows.filter(fn).length;
  const st = s => reviewState(s).key;
  const ready = count(s=>st(s)==="ready"), manual = count(s=>["manual","failed"].includes(st(s)));
  const flagged = count(s=>{ const f = reviewFlags(s); return (f.aiFlag || f.simFlag) && !s.published; });
  const toPublish = count(s=>st(s)==="verified"), checking = count(s=>st(s)==="checking");
  const plural = (n, one, many) => `${n} ${n===1?one:many}`;
  const items = [
    ready && { text:`${plural(ready, "submission is", "submissions are")} ready for you to review.`, go:()=>jump("check", "todo") },
    manual && { text:`${plural(manual, "submission needs", "submissions need")} marking by hand: the AI couldn't check ${manual===1?"it":"them"}.`, go:()=>jump("check", "todo") },
    flagged && { text:`${plural(flagged, "submission is", "submissions are")} flagged for possible copying or AI-written text.`, go:()=>jump("check", "flagged") },
    toPublish && { text:`${plural(toPublish, "mark is", "marks are")} verified and waiting to be published.`, go:()=>jump("publish") },
    checking && { text:`${plural(checking, "submission is", "submissions are")} still being checked by the AI. Nothing to do yet.`, quiet:true },
  ].filter(Boolean);
  const box = $("todoList"); box.innerHTML = "";
  if(!items.length){
    box.innerHTML = `<li class="todo-done">${rows.length ? "You're up to date. Nothing to mark or publish right now." : "No submissions yet. They appear here when students upload work."}</li>`;
  }
  items.forEach(it=>{
    const li = document.createElement("li");
    if(it.quiet){ li.className = "todo-quiet"; li.textContent = it.text; }
    else { const b = document.createElement("button"); b.className = "todo-item"; b.type = "button"; b.textContent = it.text; b.onclick = it.go; li.appendChild(b); }
    box.appendChild(li);
  });
  const open = count(s=>["ready","manual","failed"].includes(st(s)));
  $("cntCheck").textContent = open ? `${open} to review` : "";
}
function jump(id, state){
  const sec = $(id); sec.open = true;
  if(state !== undefined){ $("fState").value = state; renderSubs(); }
  sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"start" });
}

// ---- flag thresholds (per teacher) ----
// Moving a slider previews the result live: the counts and the tags in the list update
// straight away. Nothing is saved until "Save thresholds".
const TH = [["ai_text", "thAi", "thAiN", "thAiCount", "AI-like"], ["similarity", "thSim", "thSimN", "thSimCount", "similar"]];
function renderThresholds(){
  TH.forEach(([k, range, num]) => { $(range).value = FLAGS[k]; $(num).value = FLAGS[k]; });
  updateThresholdCounts();
}
function updateThresholdCounts(){
  const scored = { ai_text: 0, similarity: 0 }, flagged = { ai_text: 0, similarity: 0 };
  allSubmissions.forEach(s=>{
    const f = reviewFlags(s);
    if(f.ai != null){ scored.ai_text++; if(f.aiFlag) flagged.ai_text++; }
    if(f.sim != null){ scored.similarity++; if(f.simFlag) flagged.similarity++; }
  });
  TH.forEach(([k, , , count, word])=>{
    $(count).textContent = scored[k]
      ? `${flagged[k]} of ${scored[k]} checked ${scored[k]===1?"submission is":"submissions are"} flagged as ${word} at this level.`
      : "No AI-checked submissions yet, so there's nothing to preview.";
  });
}
function previewThreshold(k, v){
  const n = Math.round(Number(v));
  if(!Number.isInteger(n) || n < 1 || n > 100) return;
  FLAGS[k] = n;
  TH.filter(t=>t[0]===k).forEach(([, range, num])=>{ $(range).value = n; $(num).value = n; });
  updateThresholdCounts(); renderSubs(); renderSim(); renderTodo();
}
TH.forEach(([k, range, num])=>{
  $(range).addEventListener("input", e=>previewThreshold(k, e.target.value));
  $(num).addEventListener("change", e=>previewThreshold(k, e.target.value));
});
$("thReset").onclick = ()=>{ previewThreshold("ai_text", FLAG_DEFAULTS.ai_text); previewThreshold("similarity", FLAG_DEFAULTS.similarity); $("thMsg").innerHTML = `<div class="alert">Back to the defaults. Save to keep them.</div>`; };
$("thSave").onclick = async ()=>{
  const r = await api("/settings", { method:"POST", body: JSON.stringify({ ai_text: FLAGS.ai_text, similarity: FLAGS.similarity }) });
  if(!r) return;
  $("thMsg").innerHTML = r.ok
    ? `<div class="alert ok">Saved. Work is flagged at ${FLAGS.ai_text}% AI-like and ${FLAGS.similarity}% similar, on any device you use.</div>`
    : `<div class="alert bad">${esc(r.error || "Couldn't save. Try again.")}</div>`;
};

$("selAll").onclick = ()=>{ filteredSubs().forEach(s=>checked.add(s.id)); renderSubs(); };
$("selNone").onclick = ()=>{ checked.clear(); renderSubs(); };
$("bulkDl").onclick = async ()=>{
  if(!checked.size){ alert("Select at least one submission"); return; }
  for(const s of allSubmissions.filter(s=>checked.has(s.id))) await downloadSubmission(s);
};

// ---- possible copying: one row per matched pair ----
function renderSim(){
  const box = $("simGroups");
  const byId = Object.fromEntries(allSubmissions.map(s=>[s.id, s]));
  const pairs = new Map();
  allSubmissions.filter(inScope).forEach(s=>((s.ai_review && s.ai_review.similarity) || []).forEach(m=>{
    const o = byId[m.submission_id], pct = Math.round(+m.pct || 0);
    if(!o || pct < FLAGS.similarity) return;
    const key = [s.id, o.id].sort().join("|");
    if(!pairs.has(key) || pairs.get(key).pct < pct) pairs.set(key, { a:s, b:o, pct });
  }));
  const list = [...pairs.values()].sort((x, y)=>y.pct - x.pct);
  $("cntCopy").textContent = list.length ? `${list.length} ${list.length===1?"pair":"pairs"}` : "";
  if(!list.length){ box.innerHTML = `<p class="muted small">No overlapping submissions found so far.</p>`; return; }
  box.innerHTML = `<div class="table-wrap"><table><tr><th>Overlap</th><th>Student</th><th>Student</th><th>Topic</th></tr>` + list.map(p=>
    `<tr><td><b>${p.pct}%</b></td>
      <td><a class="link" href="${reviewLink(p.a)}">${esc(p.a.student_name)}</a><br><span class="small muted">Roll ${esc(p.a.roll_no)}</span></td>
      <td><a class="link" href="${reviewLink(p.b)}">${esc(p.b.student_name)}</a><br><span class="small muted">Roll ${esc(p.b.roll_no)}</span></td>
      <td>${esc(p.a.topic_title||"")}</td></tr>`).join("") + `</table></div>`;
}

// ---- publish + csv ----
function renderPublish(){
  const rows = allSubmissions.filter(inScope);
  const waiting = rows.filter(s=>s.verified_at && !s.published).length;
  $("cntPub").textContent = waiting ? `${waiting} ready` : "";
  $("pubHint").textContent = $("fSub").value ? "" : "Choose a subject at the top to download its marks as a CSV.";
  let h = `<tr><th>Student</th><th>Topic</th><th>Your mark</th><th>Status</th><th></th></tr>`;
  rows.forEach(s=>{
    const st = reviewState(s), verified = !!s.verified_at;
    h += `<tr><td>${esc(s.student_name)}<br><span class="small muted">Roll ${esc(s.roll_no)}</span></td><td>${esc(s.topic_title||"")}</td>
      <td>${s.teacher_marks!=null?`<b>${esc(s.teacher_marks)}</b>`:'<span class="muted">—</span>'}</td>
      <td><span class="state-chip state-${st.key}">${esc(st.label)}</span></td>
      <td>${verified
        ? `<button class="btn small ${s.published?"":"ok"}" data-pub="${esc(s.id)}">${s.published?"Unpublish":"Publish"}</button>`
        : `<a class="btn small" href="${reviewLink(s)}">Review first</a>`}</td></tr>`;
  });
  if(!rows.length) h += `<tr><td colspan="5" class="muted small">No submissions yet.</td></tr>`;
  $("pubTable").innerHTML = h;
  $("pubTable").querySelectorAll("[data-pub]").forEach(b=>b.onclick=async ()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.pub);
    const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify({ id: s.id, published: !s.published }) });
    if(r && !r.ok) alert(r.error);
    await loadData();
  });
}

// Bulk publish/unpublish: one request instead of one per submission.
async function bulkPublish(published){
  const ids = allSubmissions.filter(inScope).map(s=>s.id);
  if(!ids.length){ alert("There are no submissions to publish yet."); return; }
  const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify({ ids, published }) });
  await loadData();
  if(!r) return;
  if(!r.ok){ alert(r.error); return; }
  alert(published
    ? `Published ${r.updated} verified ${r.updated===1?"submission":"submissions"}.${r.skipped?` ${r.skipped} not verified yet, so they stayed hidden from students.`:""}`
    : `Unpublished ${r.updated} ${r.updated===1?"submission":"submissions"}.`);
}
$("pubAll").onclick = ()=>bulkPublish(true);
$("unpubAll").onclick = ()=>bulkPublish(false);
$("csvBtn").onclick = ()=>{
  const sid = $("fSub").value; if(!sid){ alert("Choose a subject at the top of the page first."); return; }
  downloadAuthed(`/csv?subject_id=${encodeURIComponent(sid)}`, `subject_${sid}_marks.csv`);
};

$("logoutBtn").onclick = logout;

init();
