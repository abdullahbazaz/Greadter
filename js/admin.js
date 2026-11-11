// Admin panel — live API backend (Neon via Vercel). Requires js/auth.js.
let session = null;
let teachers = [], sections = [], subjects = [], departments = [];

function init(){
  const s = getSession();
  if(!s || s.userType !== "admin" || !s.token){
    $("adminLoginView").hidden = false;
    $("goAdminLogin").onclick = ()=>{ location.href = LOGIN_PAGE.admin; };
    return;
  }
  session = s;
  $("adminDashboardView").hidden = false;
  $("adminLogoutBtn").onclick = logout;
  loadAll();
}

// One parallel fetch per resource (previously /teachers was fetched four times per render).
async function loadAll(){
  const [t, sec, sub, dep] = await Promise.all([api("/teachers"), api("/sections"), api("/subjects"), api("/departments")]);
  departments = (dep && dep.departments) || [];
  teachers = (t && t.teachers) || [];
  sections = (sec && sec.sections) || [];
  subjects = (sub && sub.subjects) || [];
  renderDepartments(); renderSections(); renderPending(); renderTeachers(); renderSubjects(); renderRoster(); renderAccounts();
}

async function post(path, body){
  const r = await api(path, { method:"POST", body: JSON.stringify(body) });
  if(r && !r.ok) alert(r.error || "Request failed");
  return r;
}

function row(html){ const d = document.createElement("div"); d.className = "rowline"; d.innerHTML = html; return d; }

// ---- departments ----
function renderDepartments(){
  const box = $("departmentList"); box.innerHTML = "";
  const sel = $("secDep"); const cur = sel.value;
  sel.innerHTML = departments.length ? '<option value="">Pick department</option>' : '<option value="">Add a department first</option>';
  departments.forEach(dp=>{
    const d = row(`<span class="t">${esc(dp.name)} <span class="s">${esc(dp.code)}</span></span><span><button class="linklike">Delete</button></span>`);
    d.querySelector("button").onclick = async ()=>{
      if(!confirm(`Delete department "${dp.name}"? This also deletes its sections, their subjects and all submissions.`)) return;
      await post("/departments", { id: dp.id, action:"delete" });
      await loadAll();
    };
    box.appendChild(d);
    const o = document.createElement("option"); o.value=dp.id; o.textContent=`${dp.code} — ${dp.name}`; sel.appendChild(o);
  });
  if([...sel.options].some(o=>o.value===cur)) sel.value = cur;
  if(!departments.length) box.innerHTML = `<div class="muted small">None.</div>`;
}
$("addDepBtn").onclick = async ()=>{
  const nm = $("depName").value.trim(); const cd = $("depCode").value.trim();
  if(!nm || !cd){ alert("Enter name and code"); return; }
  const r = await post("/departments", { name:nm, code:cd });
  if(r && r.ok){ $("depName").value=""; $("depCode").value=""; await loadAll(); }
};

// ---- sections ----
const secLabel = id => sectionLabel(sections.find(s=>s.id===id)) || id;
function renderSections(){
  const box = $("sectionList"); box.innerHTML = "";
  const sel = $("subjSec"); const curSub = sel.value;
  sel.innerHTML = '<option value="">Pick section</option>';
  // Batch picker: the 4 batches currently in semesters 1–8.
  const bsel = $("secBatch"); const curB = bsel.value;
  bsel.innerHTML = activeBatches().map(y=>`<option value="${y}">Admitted ${y}, ${esc(semesterText(y))}</option>`).join("");
  if(curB) bsel.value = curB;
  sections.forEach(s=>{
    const sem = semesterText(s.batch_year);
    const d = row(`<span class="t">${esc(sectionLabel(s))} <span class="s">join code ${esc(s.join_code)}${s.batch_year?"":", no admission year set"}</span></span>
      <span><button class="linklike">Delete</button></span>`);
    if(sem === "graduated") d.style.opacity = ".55";
    d.querySelector("button").onclick = async ()=>{
      if(!confirm(`Delete section "${sectionLabel(s)}"? This also deletes its subjects and their submissions.`)) return;
      await post("/sections", { id: s.id, action:"delete" });
      await loadAll();
    };
    box.appendChild(d);
    const o = document.createElement("option"); o.value=s.id; o.textContent=sectionLabel(s); sel.appendChild(o);
  });
  if([...sel.options].some(o=>o.value===curSub)) sel.value = curSub;
  if(!sections.length){ box.innerHTML = `<div class="muted small">None.</div>`; sel.innerHTML = `<option value="">No sections</option>`; }
}
$("addSecBtn").onclick = async ()=>{
  if(!$("secDep").value){ alert("Pick a department"); return; }
  const nm = $("secName").value.trim().toUpperCase(); if(!nm){ alert("Enter section name, e.g. A"); return; }
  // Join code is generated server-side with a secure random value.
  const r = await post("/sections", { name:nm, department_id:$("secDep").value, batch_year:+$("secBatch").value });
  if(r && r.ok){ $("secName").value=""; await loadAll(); }
};
$("bulkSecBtn").onclick = async ()=>{
  const dep = departments.find(d=>d.id===$("secDep").value);
  if(!dep){ alert("Pick a department"); return; }
  const years = activeBatches();
  if(!confirm(`Create sections A and B for ${dep.code} batches ${years.join(", ")}? Existing ones are kept.`)) return;
  const r = await post("/sections", { action:"bulk", department_id:dep.id, batch_years:years, names:["A","B"] });
  if(r && r.ok){ alert(`Created ${r.created} section(s), ${r.skipped} already existed.`); await loadAll(); }
};

// ---- pending teachers ----
function renderPending(){
  const box = $("pendingTeachers"); box.innerHTML = "";
  const pending = teachers.filter(t=>t.status==="pending");
  if(!pending.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  pending.forEach(t=>{
    const d = row(`<span class="t">${esc(t.name)}</span><span class="s">${esc(t.email)}, ${esc(t.dept)}</span>
      <span><button class="btn ok small" data-act="apr">Approve</button> <button class="btn danger small" data-act="rej">Reject</button></span>`);
    d.querySelector('[data-act="apr"]').onclick = async ()=>{ await post("/teacher_approve", { id:t.id, status:"active" }); await loadAll(); };
    d.querySelector('[data-act="rej"]').onclick = async ()=>{ await post("/teacher_approve", { id:t.id, status:"inactive" }); await loadAll(); };
    box.appendChild(d);
  });
}

// ---- teachers ----
function renderTeachers(){
  const box = $("teacherList"); box.innerHTML = "";
  teachers.forEach(t=>{
    const assigned = (t.section_ids||[]).map(secLabel).join(", ") || "no sections";
    const d = row(`<span class="t">${esc(t.name)} <span class="s">${esc(t.email)}, ${esc(t.status)}. Teaches: ${esc(assigned)}</span></span>
      <span><button class="linklike">Assign sections</button></span>`);
    const picker = document.createElement("div");
    picker.className = "topic"; picker.hidden = true;
    d.querySelector("button").onclick = ()=>{
      if(!sections.length){ alert("Create a section first."); return; }
      if(!picker.hidden){ picker.hidden = true; return; }
      const mine = new Set(t.section_ids||[]);
      picker.innerHTML = sections.filter(s=>semesterText(s.batch_year)!=="graduated" || mine.has(s.id)).map(s=>
        `<label class="small" style="display:block"><input type="checkbox" style="width:auto" value="${esc(s.id)}" ${mine.has(s.id)?"checked":""}> ${esc(sectionLabel(s))}</label>`).join("") +
        `<div class="toolbar"><button class="btn primary small" data-save>Save</button><button class="btn small" data-cancel>Cancel</button></div>`;
      picker.querySelector("[data-cancel]").onclick = ()=>{ picker.hidden = true; };
      picker.querySelector("[data-save]").onclick = async ()=>{
        const ids = [...picker.querySelectorAll("input:checked")].map(c=>c.value);
        const r = await post("/teacher_sections", { teacher_id:t.id, section_ids:ids });
        if(r && r.ok) await loadAll();
      };
      picker.hidden = false;
    };
    box.appendChild(d); box.appendChild(picker);
  });
  if(!teachers.length) box.innerHTML = `<div class="muted small">No teachers.</div>`;
}

// ---- subjects ----
function renderSubjects(){
  const box = $("subjectList"); box.innerHTML = "";
  subjects.forEach(s=>{
    const d = row(`<span class="t">${esc(s.name)} <span class="s">${esc([s.code, s.section_id?secLabel(s.section_id):"no section", (s.assignment_mode||"single")+" topic mode"].filter(Boolean).join(", "))}</span></span>
      <span><button class="linklike">Delete</button></span>`);
    d.querySelector("button").onclick = async ()=>{
      if(!confirm(`Delete subject "${s.name}"? This also deletes its topics and submissions.`)) return;
      await post("/subjects", { id:s.id, action:"delete" });
      await loadAll();
    };
    box.appendChild(d);
  });
  if(!subjects.length) box.innerHTML = `<div class="muted small">None.</div>`;
}
$("addSubjBtn").onclick = async ()=>{
  const sid = $("subjSec").value; if(!sid){ alert("Pick a section"); return; }
  const nm = $("subjName").value.trim(); if(!nm){ alert("Enter subject name"); return; }
  const r = await post("/subjects", { name:nm, code:$("subjCode").value.trim(), section_id:sid, assignment_mode:"single" });
  if(r && r.ok){ $("subjName").value=""; $("subjCode").value=""; await loadAll(); }
};

// ---- roster ----
function renderRoster(){
  $("rosterList").innerHTML = `<div class="muted small">Imported students have no password until they complete student signup with the same reg. no. and roll no.</div>`;
}
$("importRoster").onclick = ()=>{
  const f = $("rosterFile").files[0]; if(!f){ alert("Select a CSV"); return; }
  const reader = new FileReader();
  reader.onload = async e=>{
    const rows = String(e.target.result).trim().split(/\r?\n/).slice(1)
      .map(line=>line.split(",").map(c=>c.trim().replace(/^"|"$/g,"")))
      .filter(cols=>cols.length>=4 && cols[0]);
    let okCount = 0, failCount = 0;
    $("importRoster").disabled = true;
    // Small parallel batches: faster than one-by-one without flooding the database.
    for(let i=0; i<rows.length; i+=5){
      const results = await Promise.all(rows.slice(i, i+5).map(([reg, name, roll, dept, email, section, year])=>
        api("/signup", { method:"POST", body: JSON.stringify({ name, roll, reg, dept, email: email || `${reg}@roster.local`, section: section || null, year: year || null, role:"student" }) })));
      results.forEach(r=> r && r.ok ? okCount++ : failCount++);
    }
    $("importRoster").disabled = false;
    alert(`Roster import finished: ${okCount} added, ${failCount} skipped.`);
  };
  reader.readAsText(f);
};

// ---- accounts ----
function renderAccounts(){
  const box = $("accountList"); box.innerHTML = "";
  if(!teachers.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  teachers.forEach(a=>{
    const active = a.status==="active";
    const d = row(`<span class="t">${esc(a.name||"")} <span class="s">${esc(a.email||"")}, ${esc(a.status)}</span></span>
      <span><button class="btn ${active?"danger":"ok"} small">${active?"Deactivate":"Activate"}</button></span>`);
    d.querySelector("button").onclick = async ()=>{
      await post("/teacher_approve", { id:a.id, status: active?"inactive":"active" });
      await loadAll();
    };
    box.appendChild(d);
  });
}

init();
