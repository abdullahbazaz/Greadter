// Teacher workspace — live API backend (Neon via Vercel)
const API_BASE = "https://projectgreadter.vercel.app/api";

const $ = id => document.getElementById(id);

let session = null;
let checked = new Set();
let pendingDelete = null;

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (session && session.token) headers.Authorization = "Bearer " + session.token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) { location.href = "login.html?role=teacher"; return null; }
  return res.json();
}

async function init() {
  const raw = localStorage.getItem("greadter_session_v1");
  if (!raw) { location.href = "login.html?role=teacher"; return; }
  session = JSON.parse(raw);
  if (session.userType !== "teacher") { location.href = "login.html?role=student"; return; }

  const me = await api("/me");
  if (!me || !me.ok) { localStorage.removeItem("greadter_session_v1"); location.href = "login.html?role=teacher"; return; }

  await loadData();
  renderAll();
}

function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

let allSubjects = [];
let allTopics = [];
let allSubmissions = [];

async function loadData() {
  const s = await api("/subjects");
  allSubjects = s && s.subjects ? s.subjects : [];

  const t = await api("/sections");
  window.allSections = t && t.sections ? t.sections : [];

  renderAll();
}

async function renderAll(){
  renderSubjects();
  renderTopics();
  renderSubs();
  renderSim();
  renderReview();
  renderPublish();
}

// ---- subjects ----
function renderSubjects(){
  const box = $("subList"); box.innerHTML = "";
  const sel = $("topicSub"); sel.innerHTML = "";
  const fSub = $("fSub"); const curF = fSub.value; fSub.innerHTML = `<option value="">All subjects</option>`;
  const pubSub = $("pubSub"); const curP = pubSub.value; pubSub.innerHTML = "";

  const session2 = session;
  let mySectionIds = [];
  if(session2 && session2.userType === "teacher"){
    mySectionIds = (window.allSections||[]).filter(sec=>{
      // teacher_sections not exposed yet; for now show all subjects in demo
      return true;
    }).map(sec=>sec.id);
  }

  let subs = allSubjects.filter(s=> mySectionIds.length===0 || mySectionIds.includes(s.section_id));
  subs.forEach(s=>{
    const n = allTopics.filter(t=>t.subjectId===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline"; d.style.cursor = "default";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc(s.code||"")} · ${n} · mode: ${s.assignment_mode||"single"}</span></span>
      <span><button class="linklike" data-act="ren">Rename</button> · <button class="linklike" data-act="del">Delete</button></span>`;
    d.querySelector('[data-act="ren"]').onclick = async ()=>{
      const v = prompt("New subject name:", s.name); if(!v) return;
      await api("/subjects", { method:"POST", body: JSON.stringify({ id: s.id, name: v, code: s.code, section_id: s.section_id, assignment_mode: s.assignment_mode }) });
      await loadData(); renderAll();
    };
    d.querySelector('[data-act="del"]').onclick = ()=>{
      pendingDelete=s.id; $("delName").textContent=s.name; $("delInput").value=""; $("delConfirm").disabled=true; $("delModal").classList.add("show");
    };
    box.appendChild(d);
    const o = document.createElement("option"); o.value=s.id; o.textContent=s.name; sel.appendChild(o);
    const o2 = document.createElement("option"); o2.value=s.id; o2.textContent=s.name; fSub.appendChild(o2);
    const o3 = document.createElement("option"); o3.value=s.id; o3.textContent=s.name; pubSub.appendChild(o3);
  });
  if(curF) fSub.value = curF;
  if(curP) pubSub.value = curP;
}

$("addSubBtn").onclick = async ()=>{
  const n = $("subName").value.trim(); if(!n){ alert("Enter subject name"); return; }
  const sid = $("topicSub").value;
  await api("/subjects", {
    method:"POST",
    body: JSON.stringify({ name:n, code:$("subCode").value.trim(), section_id:sid, assignment_mode:"single" })
  });
  $("subName").value=""; $("subCode").value=""; await loadData(); renderAll();
};

$("delCancel").onclick = ()=>$("delModal").classList.remove("show");
$("delInput").oninput = e=>{ $("delConfirm").disabled = e.target.value.trim()!=="delete"; };
$("delConfirm").onclick = async ()=>{
  await api("/subjects", {
    method:"POST",
    body: JSON.stringify({ id: pendingDelete, action:"delete" })
  });
  pendingDelete=null; $("delModal").classList.remove("show"); await loadData(); renderAll();
};

// ---- topics ----
async function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const fT = $("fTopic"); const cur = fT.value; fT.innerHTML = `<option value="">All topics</option>`;

  const data = await api(`/topics?subject_id=${$("topicSub").value}`);
  const topics = data && data.topics ? data.topics : [];
  allTopics = topics;

  topics.forEach(t=>{
    const o = document.createElement("option"); o.value=t.id; o.textContent=`${t.title}`; fT.appendChild(o);
  });
  if(cur) fT.value = cur;

  const grouped = {};
  topics.forEach(t=>{ (grouped[t.subject_id]=grouped[t.subject_id]||[]).push(t); });
  Object.entries(grouped).forEach(([sid, list])=>{
    const sub = allSubjects.find(s=>s.id===sid);
    if(!sub) return;
    const h = document.createElement("h4"); h.textContent = sub.name; box.appendChild(h);
    list.forEach(t=>{
      const d = document.createElement("div");
      d.className = "topic";
      d.innerHTML = `<h4>${esc(t.title)}</h4>
        <p class="spec">${t.total_marks} marks · ${t.deadline||""}</p>
        <p class="small muted">${esc(t.overview||"")}</p><p class="small muted">${esc(t.requirements||"")}</p>
        <div class="toolbar"><button class="linklike" data-a="e">Edit</button><button class="linklike" data-a="d">Delete</button></div>`;
      d.querySelector('[data-a="d"]').onclick = async ()=>{
        if(!confirm(`Delete topic "${t.title}"?`)) return;
        await api("/topics", { method:"POST", body: JSON.stringify({ id: t.id, action:"delete" }) });
        await loadData(); renderAll();
      };
      d.querySelector('[data-a="e"]').onclick = async ()=>{
        const nt = prompt("Title:", t.title); if(nt) t.title = nt;
        const nm = prompt("Total marks:", t.total_marks); if(nm) t.total_marks = +nm||t.total_marks;
        const nd = prompt("Deadline YYYY-MM-DD:", t.deadline); if(nd) t.deadline = nd;
        await api("/topics", { method:"POST", body: JSON.stringify({ id: t.id, ...t, action:"update" }) });
        await loadData(); renderAll();
      };
      box.appendChild(d);
    });
  });
}

$("addTopicBtn").onclick = async ()=>{
  const sid = $("topicSub").value; if(!sid){ alert("No subject"); return; }
  const title = $("topicTitle").value.trim(); if(!title){ alert("Enter topic title"); return; }
  await api("/topics", {
    method:"POST",
    body: JSON.stringify({ subject_id:sid, title, overview:$("topicOverview").value.trim()||"", requirements:$("topicReq").value.trim()||"", total_marks:+$("topicMarks").value||20, deadline:$("topicDeadline").value||null })
  });
  $("topicTitle").value=""; $("topicOverview").value=""; $("topicReq").value="";
  await loadData(); renderAll();
};

// ---- submissions ----
$("fSub").addEventListener("change", renderSubs);
$("fTopic").addEventListener("change", renderSubs);
$("fSearch").addEventListener("input", renderSubs);

async function renderSubs(){
  const fs = $("fSub").value, ft = $("fTopic").value, q = $("fSearch").value.trim().toLowerCase();
  const data = await api(`/submissions_admin?subject_id=${fs||""}`);
  const rows = (data && data.submissions) || [];
  allSubmissions = rows;
  const filtered = rows.filter(s=>
    (!fs || s.subject_id===fs) && (!ft || s.topic_id===ft) &&
    (!q || (s.student_name+" "+s.roll_no+" "+s.reg_no).toLowerCase().includes(q))
  );

  let h = `<tr><th></th><th>Student (roll / reg)</th><th>Subject → Topic</th><th>File</th><th>Flags</th><th>Marks</th><th>Actions</th></tr>`;
  filtered.forEach(s=>{
    const marks = s.teacher_marks!=null?s.teacher_marks:(s.ai_marks??"—");
    h += `<tr><td><input type="checkbox" data-id="${s.id}" ${checked.has(s.id)?"checked":""}></td>
      <td><b>${esc(s.student_name)}</b><br><span class="small muted">Roll ${esc(s.roll_no)} · ${esc(s.reg_no)}</span></td>
      <td>${esc(s.subject_name||"")} → ${esc(s.topic_title||"")}<br><span class="small muted">${s.submitted_at||""}</span></td>
      <td>${esc(s.file_name)}<br><span class="small muted">${esc(s.file_type||"")} · ${s.size_kb||0}KB</span></td>
      <td>${s.late?'<span class="tag late">late</span>':""} ${s.ocr_confidence<80?`<span class="tag ocr">OCR ${s.ocr_confidence}%</span>`:""} ${s.similarity_group?`<span class="tag sim">${esc(s.similarity_group)} ${s.similarity_pct}%</span>`:""} ${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td>
      <td>AI ${s.ai_marks??"—"} / T ${s.teacher_marks??"—"}</td>
      <td><button class="btn small" data-view="${s.id}">View</button> <button class="btn small" data-dl="${s.id}">Download</button></td></tr>`;
  });
  const tbl = $("subTable"); tbl.innerHTML = h || "<tr><td>No submissions.</td></tr>";
  tbl.querySelectorAll('input[type="checkbox"]').forEach(c=>c.onchange=()=>{ c.checked?checked.add(c.dataset.id):checked.delete(c.dataset.id); $("selCount").textContent = checked.size+" selected"; });
  tbl.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.view);
    $("previewBox").textContent = `FILE: ${s.file_name} (${s.file_type}, ${s.size_kb}KB)\nSTUDENT: ${s.student_name} | Roll ${s.roll_no} | ${s.reg_no} | ${s.dept}\nTOPIC: ${s.topic_title||""} | Total ${s.total_marks||""}\nOCR confidence: ${s.ocr_confidence||100}%${(s.ocr_confidence||100)<80?" — check manually":""}\nFEEDBACK:\n` + (s.feedback||[]).map(f=>` - [${f.type}] ${esc(f.text)}${f.why?" (Why: "+esc(f.why)+")":""}`).join("\n");
  });
  tbl.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.dl);
    const blob = new Blob([`File: ${s.file_name}\nStudent: ${s.student_name} roll ${s.roll_no}`],{type:"text/plain"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = s.file_name + ".txt"; a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  });
  $("selCount").textContent = checked.size+" selected";
}

$("selAll").onclick = ()=>{ allSubmissions.forEach(s=>checked.add(s.id)); renderSubs(); };
$("selNone").onclick = ()=>{ checked.clear(); renderSubs(); };
$("bulkDl").onclick = async ()=>{
  if(!checked.size){ alert("Select at least one row"); return; }
  const rows = allSubmissions.filter(s=>checked.has(s.id));
  const manifest = rows.map(s=>`${s.student_name}, roll ${s.roll_no}, ${s.reg_no}, ${s.file_name}`).join("\n");
  const blob = new Blob([manifest],{type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "bulk-selection.txt"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
};

// ---- similarity ----
async function renderSim(){
  const box = $("simGroups"); box.innerHTML = "";
  const groups = {};
  allSubmissions.filter(s=>s.similarity_group).forEach(s=>{ (groups[s.similarity_group]=groups[s.similarity_group]||[]).push(s); });
  if(!Object.keys(groups).length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  Object.entries(groups).forEach(([g, list], i)=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(g)} — ${list.length} grouped</h4>
      <table><tr><th>Student</th><th>File</th><th>Matches</th><th>Similarity</th></tr>${list.map(s=>{
      const names = (s.similarity_with||[]).map(id=>{ const o=allSubmissions.find(x=>x.id===id); return o?`${esc(o.student_name)} (roll ${esc(o.roll_no)})`:id; }).join(", ")||"—";
      return `<tr><td><b>${esc(s.student_name)}</b> roll ${esc(s.roll_no)}</td><td>${esc(s.file_name)}</td><td>${names}</td><td><b>${s.similarity_pct}%</b></td></tr>`;
    }).join("")}</table>
      <p class="small muted">Teacher action: open Review → override / publish per student.</p>`;
    box.appendChild(d);
  });
}

// ---- review queue + grade editor ----
async function renderReview(){
  const box = $("reviewList"); box.innerHTML = "";
  const q = [...allSubmissions].sort((a,b)=>(a.ocr_confidence||100)-(b.ocr_confidence||100));
  const sel = $("gradeSub"); sel.innerHTML = "";
  if(!q.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  box.innerHTML = `<table><tr><th>Priority</th><th>Submission</th><th>OCR</th><th>AI marks</th><th>Status</th></tr>` + q.map((s,i)=>{
    const o = document.createElement("option"); o.value=s.id; o.textContent=`${s.student_name} (roll ${s.roll_no}) — ${s.file_name} — AI ${s.ai_marks??"—"}`; sel.appendChild(o);
    return `<tr><td>#${i+1}</td><td><b>${esc(s.student_name)}</b> roll ${esc(s.roll_no)} · ${esc(s.file_name)}</td>
      <td>${s.ocr_confidence<80?`<span class="tag ocr">${s.ocr_confidence}% check</span>`:s.ocr_confidence+"%"}</td>
      <td>${s.ai_marks??"—"}</td>
      <td>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td></tr>`;
  }).join("") + "</table>";
}

$("saveGrade").onclick = async ()=>{
  const s = allSubmissions.find(x=>x.id===$("gradeSub").value); if(!s) return;
  const v = $("gradeMarks").value;
  const fb = $("gradeFb").value.trim();
  await api("/submissions_admin", {
    method:"POST",
    body: JSON.stringify({ id: s.id, teacher_marks: v!==""&&v!=null?+v:null, feedback: fb?[{type:"wrong",text:fb,why:"Teacher override note."}] : [] })
  });
  $("gradeMsg").innerHTML = `<div class="alert ok">Saved for ${esc(s.student_name)}.</div>`;
  await loadData(); renderAll();
};

// ---- publish + csv ----
async function renderPublish(){
  const sid = $("pubSub").value || allSubjects[0]?.id;
  if(sid && !$("pubSub").value) $("pubSub").value = sid;
  const rows = allSubmissions.filter(s=>s.subject_id===sid);
  let h = `<tr><th>Student</th><th>Roll / Reg</th><th>Topic</th><th>AI / Teacher</th><th>Published</th><th>Action</th></tr>`;
  rows.forEach(s=>{
    const top = allTopics.find(x=>x.id===s.topic_id)?.title||"?";
    h += `<tr><td>${esc(s.student_name)}</td><td>${esc(s.roll_no)} / ${esc(s.reg_no)}</td><td>${esc(top)}</td>
      <td>${s.ai_marks??"—"} / ${s.teacher_marks??"—"}</td>
      <td>${s.published?'<span class="tag pub">yes</span>':'<span class="tag unpub">no</span>'}</td>
      <td><button class="btn small ${s.published?"":"ok"}" data-pub="${s.id}">${s.published?"Unpublish":"Publish"}</button></td></tr>`;
  });
  $("pubTable").innerHTML = h;
  $("pubTable").querySelectorAll("[data-pub]").forEach(b=>b.onclick=async ()=>{
    const s = allSubmissions.find(x=>x.id===b.dataset.pub);
    const newPub = !s.published;
    await api("/submissions_admin", {
      method:"POST",
      body: JSON.stringify({ id: s.id, published: newPub, teacher_marks: newPub && s.teacher_marks==null && s.ai_marks!=null ? s.ai_marks : s.teacher_marks })
    });
    await loadData(); renderAll();
  });
}

$("pubSub").addEventListener("change", renderPublish);
$("pubAll").onclick = async ()=>{
  const sid = $("pubSub").value; let n=0;
  for(const s of allSubmissions.filter(s=>s.subject_id===sid)){
    await api("/submissions_admin", {
      method:"POST",
      body: JSON.stringify({ id: s.id, published: true, teacher_marks: s.teacher_marks==null && s.ai_marks!=null ? s.ai_marks : s.teacher_marks })
    });
    n++;
  }
  await loadData(); renderAll(); alert(`Published ${n} submission(s).`);
};
$("unpubAll").onclick = async ()=>{
  const sid = $("pubSub").value;
  for(const s of allSubmissions.filter(s=>s.subject_id===sid)){
    await api("/submissions_admin", { method:"POST", body: JSON.stringify({ id: s.id, published: false }) });
  }
  await loadData(); renderAll();
};
$("csvBtn").onclick = async ()=>{
  const sid = $("pubSub").value;
  window.location.href = `${API_BASE}/csv?subject_id=${sid}`;
};

// ---- logout ----
const logoutBtn = document.createElement("button");
logoutBtn.className = "linklike";
logoutBtn.textContent = "Log out";
logoutBtn.onclick = ()=>{ fetch(API_BASE+"/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:session.token})}); localStorage.removeItem("greadter_session_v1"); location.href = "login.html"; };
document.querySelector("main .container").appendChild(Object.assign(document.createElement("p"),{className:"note"})).appendChild(logoutBtn);

init();
