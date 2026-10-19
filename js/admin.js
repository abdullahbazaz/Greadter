// Admin panel — live API backend (Neon via Vercel)
const API_BASE = "https://projectgreadter.vercel.app/api";

const $ = id => document.getElementById(id);

let session = null;

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (session && session.token) headers.Authorization = "Bearer " + session.token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) { location.href = "login.html?role=admin"; return null; }
  return res.json();
}

async function init() {
  const raw = localStorage.getItem("greadter_session_v1");
  if (!raw) { location.href = "login.html?role=admin"; return; }
  session = JSON.parse(raw);
  if (session.userType !== "admin") {
    // admin page: allow teacher too for demo simplicity
  }

  await renderAll();
}

function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

async function renderAll(){
  await renderDepartments();
  await renderSections();
  await renderPending();
  await renderTeachers();
  await renderSubjects();
  await renderRoster();
  await renderAccounts();
}

// ---- departments ----
async function renderDepartments(){
  const box = $("departmentList"); box.innerHTML = "";
  const sel = $("secDep"); sel.innerHTML = '<option value="">Pick department</option>';
  const data = await api("/teachers");
  // departments not yet in API; render from local fallback for now
  box.innerHTML = `<div class="muted small">Departments managed via Neon SQL directly.</div>`;
  sel.innerHTML = '<option value="">No departments in API yet</option>';
}
$("addDepBtn").onclick = async ()=>{
  const nm = $("depName").value.trim(); const cd = $("depCode").value.trim().toUpperCase();
  if(!nm || !cd){ alert("Enter name and code"); return; }
  alert("Department creation via Neon SQL for now. Add row to departments table.");
};

// ---- sections ----
async function renderSections(){
  const box = $("sectionList"); box.innerHTML = "";
  const sel = $("subjSec"); sel.innerHTML = '<option value="">Pick section</option>';
  const data = await api("/sections");
  const sections = data && data.sections ? data.sections : [];
  sections.forEach(s=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">code ${s.join_code}</span></span>
      <span><button class="linklike" data-act="del" data-id="${s.id}">Delete</button></span>`;
    box.appendChild(d);
    const o = document.createElement("option"); o.value=s.id; o.textContent=s.name; sel.appendChild(o);
  });
  if(!sections.length){ box.innerHTML = `<div class="muted small">None.</div>`; sel.innerHTML = `<option value="">No sections</option>`; }
}
$("addSecBtn").onclick = async ()=>{
  const did = $("secDep").value;
  const nm = $("secName").value.trim(); if(!nm){ alert("Enter section name"); return; }
  const jc = "GC"+Date.now();
  const res = await api("/sections", {
    method:"POST",
    body: JSON.stringify({ name:nm, department_id:did||null, join_code:jc })
  });
  if(res && res.ok){ $("secName").value=""; await renderSections(); await renderSubjects(); }
};

// ---- pending teachers ----
async function renderPending(){
  const box = $("pendingTeachers"); box.innerHTML = "";
  const data = await api("/teachers");
  const teachers = data && data.teachers ? data.teachers : [];
  const pending = teachers.filter(t=>t.status==="pending");
  if(!pending.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  pending.forEach(t=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(t.name)}</span><span class="s">${esc(t.email)} · ${esc(t.dept)}</span>
      <span>
        <button class="btn ok small" data-act="apr" data-id="${t.id}">Approve</button>
        <button class="btn danger small" data-act="rej" data-id="${t.id}">Reject</button>
      </span>`;
    d.querySelector('[data-act="apr"]').onclick = async ()=>{
      await api("/teacher_approve", { method:"POST", body: JSON.stringify({ id:t.id, status:"active" }) });
      await renderAll();
    };
    d.querySelector('[data-act="rej"]').onclick = async ()=>{
      await api("/teacher_approve", { method:"POST", body: JSON.stringify({ id:t.id, status:"inactive" }) });
      await renderAll();
    };
    box.appendChild(d);
  });
}

// ---- teachers ----
async function renderTeachers(){
  const box = $("teacherList"); box.innerHTML = "";
  const data = await api("/teachers");
  const teachers = data && data.teachers ? data.teachers : [];
  teachers.forEach(t=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(t.name)} <span class="s">${esc(t.email)} · ${t.status}</span></span>
      <span><button class="linklike" data-act="assign" data-id="${t.id}">Assign sections</button></span>`;
    d.querySelector('[data-act="assign"]').onclick = async ()=>{
      const sectionsData = await api("/sections");
      const secs = sectionsData && sectionsData.sections ? sectionsData.sections : [];
      const current = ""; // would need section_teachers API
      const newSec = prompt("Assign section IDs (comma-separated):", current);
      if(newSec===null) return;
      const ids = newSec.split(",").map(s=>s.trim()).filter(Boolean);
      await api("/teacher_sections", { method:"POST", body: JSON.stringify({ teacher_id:t.id, section_ids:ids }) });
      await renderAll();
    };
    box.appendChild(d);
  });
  if(!teachers.length) box.innerHTML = `<div class="muted small">No teachers.</div>`;
}

// ---- subjects ----
async function renderSubjects(){
  const box = $("subjectList"); box.innerHTML = "";
  const data = await api("/subjects");
  const subjects = data && data.subjects ? data.subjects : [];
  subjects.forEach(s=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc(s.code||"")} · mode: ${s.assignment_mode||"single"}</span></span>
      <span><button class="linklike" data-act="del" data-id="${s.id}">Delete</button></span>`;
    d.querySelector('[data-act="del"]').onclick = async ()=>{
      if(!confirm(`Delete subject "${s.name}"?`)) return;
      await api("/subjects", { method:"POST", body: JSON.stringify({ id:s.id, action:"delete" }) });
      await renderSubjects();
    };
    box.appendChild(d);
  });
  if(!subjects.length) box.innerHTML = `<div class="muted small">None.</div>`;
}
$("addSubjBtn").onclick = async ()=>{
  const sid = $("subjSec").value; if(!sid){ alert("Pick a section"); return; }
  const nm = $("subjName").value.trim(); if(!nm){ alert("Enter subject name"); return; }
  const res = await api("/subjects", {
    method:"POST",
    body: JSON.stringify({ name:nm, code:$("subjCode").value.trim(), section_id:sid, assignment_mode:"single" })
  });
  if(res && res.ok){ $("subjName").value=""; $("subjCode").value=""; await renderSubjects(); }
};

// ---- roster ----
async function renderRoster(){
  const box = $("rosterList"); box.innerHTML = "";
  box.innerHTML = `<div class="muted small">Roster import via Neon SQL / CSV upload endpoint coming soon.</div>`;
}
$("importRoster").onclick = async ()=>{
  const f = $("rosterFile").files[0]; if(!f){ alert("Select a CSV"); return; }
  const reader = new FileReader();
  reader.onload = async e=>{
    const text = e.target.result;
    const lines = text.trim().split("\n");
    for(const line of lines.slice(1)){
      const cols = line.split(",");
      if(cols.length<4) continue;
      const [reg, name, roll, dept, email] = cols.map(c=>c.trim());
      await api("/signup", {
        method:"POST",
        body: JSON.stringify({ name, roll, reg:reg, dept, email:email||"", pass:"", role:"student" })
      });
    }
    alert("Roster imported via signup API.");
    await renderRoster(); await renderAccounts();
  };
  reader.readAsText(f);
};

// ---- accounts ----
async function renderAccounts(){
  const box = $("accountList"); box.innerHTML = "";
  const data = await api("/teachers");
  const teachers = data && data.teachers ? data.teachers : [];
  if(!teachers.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  teachers.forEach(a=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(a.name||"")} <span class="s">teacher · ${esc(a.email||"")} · ${a.status}</span></span>
      <span><button class="btn ${a.status==="active"?"danger":"ok"} small" data-act="${a.status==="active"?"deact":"act"}" data-id="${a.id}">${a.status==="active"?"Deactivate":"Activate"}</button></span>`;
    d.querySelector('[data-act]').onclick = async ()=>{
      await api("/teacher_approve", { method:"POST", body: JSON.stringify({ id:a.id, status: a.status==="active"?"inactive":"active" }) });
      await renderAccounts(); await renderTeachers(); await renderPending();
    };
    box.appendChild(d);
  });
}

// ---- init + logout ----
init();

const logoutBtn = document.createElement("button");
logoutBtn.className = "linklike";
logoutBtn.textContent = "Log out";
logoutBtn.onclick = ()=>{ fetch(API_BASE+"/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:session.token})}); localStorage.removeItem("greadter_session_v1"); location.href = "login.html"; };
document.querySelector("main .container").appendChild(Object.assign(document.createElement("p"),{className:"note"})).appendChild(logoutBtn);
