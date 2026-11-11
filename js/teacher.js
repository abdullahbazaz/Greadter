// Teacher workspace — live API backend (Neon via Vercel). Requires js/auth.js.
const session = requirePageRole("teacher");
let checked = new Set();
let pendingDelete = null;
let allSubjects = [];
let allTopics = [];
let allSubmissions = [];
let mySections = [];

const ocrTag = s => s.ocr_confidence != null && s.ocr_confidence < 80 ? `<span class="tag ocr">OCR ${esc(s.ocr_confidence)}%</span>` : "";

async function init(){
  if(!session) return;
  const me = await api("/me");
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

function renderAll(){ renderSubjects(); renderTopics(); renderSubs(); renderSim(); renderReview(); renderPublish(); }

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
    const secName = (mySections.find(x=>x.id===s.section_id)||{}).name || "";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc(s.code||"")} · ${esc(secName)} · ${n} topic(s) · mode: ${esc(s.assignment_mode||"single")}</span></span>
      <span><button class="linklike" data-act="ren">Rename</button> · <button class="linklike" data-act="del">Delete</button></span>`;
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
  fillSelect($("subSec"), mySections, {placeholder: mySections.length ? "Pick section" : "No sections assigned"});
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
      <p class="spec">${esc(t.total_marks ?? "—")} marks · ${esc(fmtDate(t.deadline))}</p>
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

// ---- submissions ----
$("fSub").addEventListener("change", ()=>{ renderTopics(); renderSubs(); });
$("fTopic").addEventListener("change", renderSubs);
$("fSearch").addEventListener("input", renderSubs);

function filteredSubs(){
  const fs = $("fSub").value, ft = $("fTopic").value, q = $("fSearch").value.trim().toLowerCase();
  return allSubmissions.filter(s=>
    (!fs || s.subject_id===fs) && (!ft || s.topic_id===ft) &&
    (!q || `${s.student_name} ${s.roll_no} ${s.reg_no}`.toLowerCase().includes(q)));
}

function renderSubs(){
  let h = `<tr><th></th><th>Student (roll / reg)</th><th>Subject → Topic</th><th>File</th><th>Flags</th><th>Marks</th><th>Actions</th></tr>`;
  const rows = filteredSubs();
  rows.forEach(s=>{
    h += `<tr><td><input type="checkbox" data-id="${esc(s.id)}" ${checked.has(s.id)?"checked":""}></td>
      <td><b>${esc(s.student_name)}</b><br><span class="small muted">Roll ${esc(s.roll_no)} · ${esc(s.reg_no)}</span></td>
      <td>${esc(s.subject_name||"")} → ${esc(s.topic_title||"")}<br><span class="small muted">${esc(fmtTime(s.submitted_at))}</span></td>
      <td>${esc(s.file_name)}<br><span class="small muted">${esc(s.file_type||"")} · ${esc(s.size_kb||0)}KB</span></td>
      <td>${s.late?'<span class="tag late">late</span>':""} ${ocrTag(s)} ${s.similarity_group?`<span class="tag sim">${esc(s.similarity_group)} ${esc(s.similarity_pct)}%</span>`:""} ${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td>
      <td>AI ${esc(s.ai_marks??"—")} / T ${esc(s.teacher_marks??"—")}</td>
      <td><button class="btn small" data-view="${esc(s.id)}">View</button> <button class="btn small" data-dl="${esc(s.id)}">Download</button></td></tr>`;
  });
  if(!rows.length) h += `<tr><td colspan="7" class="muted small">No submissions.</td></tr>`;
  const tbl = $("subTable"); tbl.innerHTML = h;
  tbl.querySelectorAll('input[type="checkbox"]').forEach(c=>c.onchange=()=>{ c.checked?checked.add(c.dataset.id):checked.delete(c.dataset.id); $("selCount").textContent = checked.size+" selected"; });
  tbl.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.view); if(!s) return;
    const ocr = s.ocr_confidence ?? null;
    // textContent: no HTML escaping needed here.
    $("previewBox").textContent = `FILE: ${s.file_name} (${s.file_type}, ${s.size_kb}KB)\nSTUDENT: ${s.student_name} | Roll ${s.roll_no} | ${s.reg_no} | ${s.dept||""}\nTOPIC: ${s.topic_title||""} | Total ${s.total_marks??""}\nOCR confidence: ${ocr==null?"n/a":ocr+"%"}${ocr!=null&&ocr<80?" — check manually":""}\nFEEDBACK:\n` + (s.feedback||[]).map(f=>` - [${f.type}] ${f.text}${f.why?" (Why: "+f.why+")":""}`).join("\n");
  });
  tbl.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>downloadSubmission(allSubmissions.find(x=>x.id===b.dataset.dl)));
  $("selCount").textContent = checked.size+" selected";
}

$("selAll").onclick = ()=>{ filteredSubs().forEach(s=>checked.add(s.id)); renderSubs(); };
$("selNone").onclick = ()=>{ checked.clear(); renderSubs(); };
$("bulkDl").onclick = async ()=>{
  if(!checked.size){ alert("Select at least one row"); return; }
  for(const s of allSubmissions.filter(s=>checked.has(s.id))) await downloadSubmission(s);
};

// ---- similarity ----
function renderSim(){
  const box = $("simGroups"); box.innerHTML = "";
  const groups = {};
  allSubmissions.filter(s=>s.similarity_group).forEach(s=>{ (groups[s.similarity_group]=groups[s.similarity_group]||[]).push(s); });
  if(!Object.keys(groups).length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  Object.entries(groups).forEach(([g, list])=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(g)} — ${list.length} grouped</h4>
      <table><tr><th>Student</th><th>File</th><th>Matches</th><th>Similarity</th></tr>${list.map(s=>{
      const names = (Array.isArray(s.similarity_with)?s.similarity_with:[]).map(id=>{ const o=allSubmissions.find(x=>x.id===id); return o?`${esc(o.student_name)} (roll ${esc(o.roll_no)})`:esc(id); }).join(", ")||"—";
      return `<tr><td><b>${esc(s.student_name)}</b> roll ${esc(s.roll_no)}</td><td>${esc(s.file_name)}</td><td>${names}</td><td><b>${esc(s.similarity_pct)}%</b></td></tr>`;
    }).join("")}</table>
      <p class="small muted">Teacher action: open Review → override / publish per student.</p>`;
    box.appendChild(d);
  });
}

// ---- review queue + grade editor ----
function renderReview(){
  const box = $("reviewList");
  const q = [...allSubmissions].sort((a,b)=>(a.ocr_confidence??100)-(b.ocr_confidence??100));
  fillSelect($("gradeSub"), q, {label:s=>`${s.student_name} (roll ${s.roll_no}) — ${s.file_name} — AI ${s.ai_marks??"—"}`});
  if(!q.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  box.innerHTML = `<table><tr><th>Priority</th><th>Submission</th><th>OCR</th><th>AI marks</th><th>Status</th></tr>` + q.map((s,i)=>
    `<tr><td>#${i+1}</td><td><b>${esc(s.student_name)}</b> roll ${esc(s.roll_no)} · ${esc(s.file_name)}</td>
      <td>${s.ocr_confidence==null?"—":s.ocr_confidence<80?`<span class="tag ocr">${esc(s.ocr_confidence)}% check</span>`:esc(s.ocr_confidence)+"%"}</td>
      <td>${esc(s.ai_marks??"—")}</td>
      <td>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td></tr>`).join("") + "</table>";
}

$("saveGrade").onclick = async ()=>{
  const s = allSubmissions.find(x=>x.id===$("gradeSub").value); if(!s) return;
  const v = $("gradeMarks").value;
  if(v !== "" && !Number.isInteger(+v)){ alert("Marks must be a whole number"); return; }
  const fb = $("gradeFb").value.trim();
  const r = await api("/submissions_admin", { method:"POST",
    body: JSON.stringify({ id: s.id, teacher_marks: v!=="" ? +v : null, feedback: fb?[{type:"wrong",text:fb,why:"Teacher override note."}] : [] }) });
  $("gradeMsg").innerHTML = r && r.ok
    ? `<div class="alert ok">Saved for ${esc(s.student_name)}.</div>`
    : `<div class="alert bad">${esc((r && r.error) || "Save failed")}</div>`;
  await loadData();
};

// ---- publish + csv ----
function renderPublish(){
  const sid = $("pubSub").value;
  const rows = allSubmissions.filter(s=>s.subject_id===sid);
  let h = `<tr><th>Student</th><th>Roll / Reg</th><th>Topic</th><th>AI / Teacher</th><th>Published</th><th>Action</th></tr>`;
  rows.forEach(s=>{
    h += `<tr><td>${esc(s.student_name)}</td><td>${esc(s.roll_no)} / ${esc(s.reg_no)}</td><td>${esc(s.topic_title||"?")}</td>
      <td>${esc(s.ai_marks??"—")} / ${esc(s.teacher_marks??"—")}</td>
      <td>${s.published?'<span class="tag pub">yes</span>':'<span class="tag unpub">no</span>'}</td>
      <td><button class="btn small ${s.published?"":"ok"}" data-pub="${esc(s.id)}">${s.published?"Unpublish":"Publish"}</button></td></tr>`;
  });
  if(!rows.length) h += `<tr><td colspan="6" class="muted small">No submissions for this subject.</td></tr>`;
  $("pubTable").innerHTML = h;
  $("pubTable").querySelectorAll("[data-pub]").forEach(b=>b.onclick=async ()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.pub);
    await api("/submissions_admin", { method:"POST", body: JSON.stringify({ id: s.id, published: !s.published }) });
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
  if(r) alert(r.ok ? `${published?"Published":"Unpublished"} ${r.updated} submission(s).` : r.error);
}
$("pubAll").onclick = ()=>bulkPublish(true);
$("unpubAll").onclick = ()=>bulkPublish(false);
$("csvBtn").onclick = ()=>{
  const sid = $("pubSub").value; if(!sid){ alert("Pick a subject"); return; }
  downloadAuthed(`/csv?subject_id=${encodeURIComponent(sid)}`, `subject_${sid}_marks.csv`);
};

$("logoutBtn").onclick = logout;

init();
