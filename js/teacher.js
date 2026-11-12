// Teacher workspace — live API backend (Neon via Vercel). Requires js/auth.js.
const session = requirePageRole("teacher");
let checked = new Set();
let pendingDelete = null;
let allSubjects = [];
let allTopics = [];
let allSubmissions = [];
let mySections = [];


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
  allSubmissions = (subs && subs.submissions) || [];
  const ids = new Set(allSubmissions.map(x=>x.id));
  checked = new Set([...checked].filter(id=>ids.has(id)));
  renderAll();
}

function renderAll(){ renderSubjects(); renderTopics(); renderSubs(); renderSim(); renderPublish(); renderThresholds(); }

function fillSelect(sel, items, {placeholder, label=x=>x.name}={}){
  const cur = sel.value;
  sel.innerHTML = placeholder ? `<option value="">${esc(placeholder)}</option>` : "";
  items.forEach(x=>{ const o=document.createElement("option"); o.value=x.id; o.textContent=label(x); sel.appendChild(o); });
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
}

// ---- subjects ----
function renderSubjects(){
  const box = $("subList"); box.innerHTML = "";
  allSubjects.forEach(s=>{
    const n = allTopics.filter(t=>t.subject_id===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline"; d.style.cursor = "default";
    const secName = sectionLabel(mySections.find(x=>x.id===s.section_id));
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc([s.code, secName, `${n} ${n===1?"topic":"topics"}`, (s.assignment_mode||"single")+" topic mode"].filter(Boolean).join(", "))}</span></span>
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
  else if(!allSubjects.length) box.innerHTML = `<div class="muted small">No subjects yet.</div>`;
  fillSelect($("subSec"), mySections, {placeholder: mySections.length ? "Pick section" : "No sections assigned", label: sectionLabel});
  fillSelect($("topicSub"), allSubjects);
  fillSelect($("fSub"), allSubjects, {placeholder:"All subjects"});
  fillSelect($("pubSub"), allSubjects);
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
function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const sid = $("topicSub").value;
  const sub = allSubjects.find(s=>s.id===sid);
  const list = allTopics.filter(t=>t.subject_id===sid);
  if(!sub){ box.innerHTML = `<div class="muted small">Create a subject first.</div>`; }
  else if(!list.length){ box.innerHTML = `<div class="muted small">No topics for ${esc(sub.name)} yet.</div>`; }
  list.forEach(t=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(t.title)}</h4>
      <p class="spec">${esc(t.total_marks ?? "—")} marks${t.deadline?`, due ${esc(fmtDate(t.deadline))}`:""}</p>
      <p class="small muted">${esc(t.overview||"")}</p><p class="small muted">${esc(t.requirements||"")}</p>
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
    box.appendChild(d);
  });
  // Submission filter: topics of the filtered subject (or all).
  const fs = $("fSub").value;
  fillSelect($("fTopic"), allTopics.filter(t=>!fs || t.subject_id===fs), {placeholder:"All topics", label:t=>t.title});
}
$("topicSub").addEventListener("change", renderTopics);

$("addTopicBtn").onclick = async ()=>{
  const sid = $("topicSub").value; if(!sid){ alert("No subject"); return; }
  const title = $("topicTitle").value.trim(); if(!title){ alert("Enter topic title"); return; }
  const r = await api("/topics", { method:"POST", body: JSON.stringify({ subject_id:sid, title, overview:$("topicOverview").value.trim(), requirements:$("topicReq").value.trim(), total_marks:+$("topicMarks").value||20, deadline:$("topicDeadline").value||null }) });
  if(r && !r.ok){ alert(r.error); return; }
  $("topicTitle").value=""; $("topicOverview").value=""; $("topicReq").value="";
  await loadData();
};

// ---- submissions to check ----
$("fSub").addEventListener("change", ()=>{ renderTopics(); renderSubs(); });
$("fTopic").addEventListener("change", renderSubs);
$("fSearch").addEventListener("input", renderSubs);
$("fState").addEventListener("change", renderSubs);

const reviewLink = s => `review.html?id=${encodeURIComponent(s.id)}`;

function filteredSubs(){
  const fs = $("fSub").value, ft = $("fTopic").value, fst = $("fState").value, q = $("fSearch").value.trim().toLowerCase();
  return allSubmissions.filter(s=>{
    const st = reviewState(s).key, f = reviewFlags(s);
    return (!fs || s.subject_id===fs) && (!ft || s.topic_id===ft) &&
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
      <td>${esc(s.topic_title||"")}<br><span class="small muted">${esc(s.subject_name||"")}, ${esc(fmtTime(s.submitted_at))}</span></td>
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
  updateThresholdCounts(); renderSubs(); renderSim();
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
  allSubmissions.forEach(s=>((s.ai_review && s.ai_review.similarity) || []).forEach(m=>{
    const o = byId[m.submission_id], pct = Math.round(+m.pct || 0);
    if(!o || pct < FLAGS.similarity) return;
    const key = [s.id, o.id].sort().join("|");
    if(!pairs.has(key) || pairs.get(key).pct < pct) pairs.set(key, { a:s, b:o, pct });
  }));
  const list = [...pairs.values()].sort((x, y)=>y.pct - x.pct);
  if(!list.length){ box.innerHTML = `<p class="muted small">No overlapping submissions found so far.</p>`; return; }
  box.innerHTML = `<div class="table-wrap"><table><tr><th>Overlap</th><th>Student</th><th>Student</th><th>Topic</th></tr>` + list.map(p=>
    `<tr><td><b>${p.pct}%</b></td>
      <td><a class="link" href="${reviewLink(p.a)}">${esc(p.a.student_name)}</a><br><span class="small muted">Roll ${esc(p.a.roll_no)}</span></td>
      <td><a class="link" href="${reviewLink(p.b)}">${esc(p.b.student_name)}</a><br><span class="small muted">Roll ${esc(p.b.roll_no)}</span></td>
      <td>${esc(p.a.topic_title||"")}</td></tr>`).join("") + `</table></div>`;
}

// ---- publish + csv ----
function renderPublish(){
  const sid = $("pubSub").value;
  const rows = allSubmissions.filter(s=>s.subject_id===sid);
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
  if(!rows.length) h += `<tr><td colspan="5" class="muted small">No submissions for this subject.</td></tr>`;
  $("pubTable").innerHTML = h;
  $("pubTable").querySelectorAll("[data-pub]").forEach(b=>b.onclick=async ()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.pub);
    const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify({ id: s.id, published: !s.published }) });
    if(r && !r.ok) alert(r.error);
    await loadData();
  });
}

$("pubSub").addEventListener("change", renderPublish);
// Bulk publish/unpublish: one request instead of one per submission.
async function bulkPublish(published){
  const ids = allSubmissions.filter(s=>s.subject_id===$("pubSub").value).map(s=>s.id);
  if(!ids.length){ alert("No submissions for this subject."); return; }
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
  const sid = $("pubSub").value; if(!sid){ alert("Pick a subject"); return; }
  downloadAuthed(`/csv?subject_id=${encodeURIComponent(sid)}`, `subject_${sid}_marks.csv`);
};

$("logoutBtn").onclick = logout;

init();
