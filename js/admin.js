// Admin panel logic — mock backend, replace with Neon API later.
const $ = id => document.getElementById(id);

// ---- render pending teachers ----
function renderPending(){
  const box = $("pendingTeachers"); box.innerHTML = "";
  const db = loadDB();
  const pending = db.teachers.filter(t=>t.status==="pending");
  if(!pending.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  pending.forEach(t=>{
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(t.name)}</span><span class="s">${esc(t.email)} · ${esc(t.dept)}</span>
      <span>
        <button class="btn ok small" data-act="apr" data-id="${t.id}">Approve</button>
        <button class="btn danger small" data-act="rej" data-id="${t.id}">Reject</button>
      </span>`;
    d.querySelector('[data-act="apr"]').onclick = ()=>{
      const u = db.teachers.find(x=>x.id===t.id); u.status="active"; saveDB(db); renderPending(); renderTeachers(); renderAccounts();
    };
    d.querySelector('[data-act="rej"]').onclick = ()=>{
      db.teachers = db.teachers.filter(x=>x.id!==t.id); saveDB(db); renderPending(); renderTeachers(); renderAccounts();
    };
    box.appendChild(d);
  });
}

// ---- render teachers + section assignments ----
function renderTeachers(){
  const box = $("teacherList"); box.innerHTML = "";
  const db = loadDB();
  db.teachers.forEach(t=>{
    const secs = db.section_teachers.filter(st=>st.teacher_id===t.id).map(st=>{
      const s = db.sections.find(x=>x.id===st.section_id); return s?esc(s.name):"?";
    }).join(", ") || "none";
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(t.name)} <span class="s">${esc(t.email)} · ${t.status}</span></span>
      <span class="s">Sections: ${secs}</span>
      <span><button class="linklike" data-act="assign" data-id="${t.id}">Assign sections</button></span>`;
    d.querySelector('[data-act="assign"]').onclick = ()=>{
      const newSec = prompt("Assign section IDs (comma-separated, e.g. sec1,sec2):", secs?secs:"");
      if(newSec===null) return;
      const ids = newSec.split(",").map(s=>s.trim()).filter(Boolean);
      db.section_teachers = db.section_teachers.filter(st=>st.teacher_id!==t.id);
      ids.forEach(sid=>{ if(db.sections.find(x=>x.id===sid)) db.section_teachers.push({teacher_id:t.id, section_id:sid}); });
      saveDB(db); renderTeachers(); renderAccounts();
    };
    box.appendChild(d);
  });
  if(!db.teachers.length) box.innerHTML = `<div class="muted small">No teachers.</div>`;
}

// ---- render sections ----
function renderSections(){
  const box = $("sectionList"); box.innerHTML = "";
  const sel = $("subjSec"); sel.innerHTML = "";
  const db = loadDB();
  db.sections.forEach(s=>{
    const tCount = db.section_teachers.filter(st=>st.section_id===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">code: ${s.joinCode} · ${tCount} teacher(s)</span></span>
      <span><button class="linklike" data-act="del" data-id="${s.id}">Delete</button></span>`;
    d.querySelector('[data-act="del"]').onclick = ()=>{
      if(!confirm(`Delete section "${s.name}"?`)) return;
      db.sections = db.sections.filter(x=>x.id!==s.id);
      db.section_teachers = db.section_teachers.filter(x=>x.section_id!==s.id);
      db.enrollments = db.enrollments.filter(x=>x.section_id!==s.id);
      saveDB(db); renderSections(); renderSubjects(); renderTeacherSubjects();
    };
    box.appendChild(d);
    const o = document.createElement("option"); o.value=s.id; o.textContent=`${s.name} (${s.joinCode})`; sel.appendChild(o);
  });
  if(!db.sections.length){ box.innerHTML = `<div class="muted small">None.</div>`; sel.innerHTML = `<option value="">No sections</option>`; }
}
$("addSecBtn").onclick = ()=>{
  const n = $("secName").value.trim(); if(!n){ alert("Enter section name"); return; }
  const db = loadDB();
  db.sections.push({id: uid("sec_"), name: n, joinCode: makeJoinCode()});
  $("secName").value=""; saveDB(db); renderSections(); renderSubjects();
};

// ---- render subjects ----
function renderSubjects(){
  const box = $("subjectList"); box.innerHTML = "";
  const db = loadDB();
  db.subjects.forEach(s=>{
    const sec = db.sections.find(x=>x.id===s.section_id);
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc(s.code||"")} · section: ${sec?esc(sec.name):"?"} · mode: ${s.mode||"single"}</span></span>
      <span><button class="linklike" data-act="del" data-id="${s.id}">Delete</button></span>`;
    d.querySelector('[data-act="del"]').onclick = ()=>{
      if(!confirm(`Delete subject "${s.name}"?`)) return;
      db.subjects = db.subjects.filter(x=>x.id!==s.id);
      db.topics = db.topics.filter(t=>t.subjectId!==s.id);
      db.custom_topics = db.custom_topics.filter(ct=>ct.subjectId!==s.id);
      saveDB(db); renderSubjects(); renderTeacherSubjects();
    };
    box.appendChild(d);
  });
  if(!db.subjects.length) box.innerHTML = `<div class="muted small">None.</div>`;
}
$("addSubjBtn").onclick = ()=>{
  const sid = $("subjSec").value; if(!sid){ alert("Pick a section"); return; }
  const nm = $("subjName").value.trim(); if(!nm){ alert("Enter subject name"); return; }
  const db = loadDB();
  db.subjects.push({id:"sub"+Date.now(), name:nm, code:$("subjCode").value.trim(), section_id:sid, mode:"single"});
  $("subjName").value=""; $("subjCode").value=""; saveDB(db); renderSubjects(); renderTeacherSubjects();
};

// ---- render roster ----
function renderRoster(){
  const box = $("rosterList"); box.innerHTML = "";
  const db = loadDB();
  db.students.forEach(st=>{
    const sec = db.sections.find(x=>x.id=== (db.enrollments.find(e=>e.student_reg_no===st.reg_no)?.section_id));
    const d = document.createElement("div");
    d.className = "rowline";
    d.innerHTML = `<span class="t">${esc(st.name)} <span class="s">${esc(st.reg_no)} · ${esc(st.roll_no)} · ${esc(st.dept)}</span></span>
      <span class="s">Section: ${sec?esc(sec.name):"not enrolled"}</span>`;
    box.appendChild(d);
  });
  if(!db.students.length) box.innerHTML = `<div class="muted small">None.</div>`;
}
$("importRoster").onclick = ()=>{
  const f = $("rosterFile").files[0]; if(!f){ alert("Select a CSV"); return; }
  const reader = new FileReader();
  reader.onload = e=>{
    const text = e.target.result;
    const lines = text.trim().split("\n");
    const db = loadDB();
    let added=0;
    lines.slice(1).forEach(line=>{
      const cols = line.split(",");
      if(cols.length<5) return;
      const [reg, name, roll, dept, secId] = cols.map(c=>c.trim());
      if(!db.students.find(s=>s.reg_no===reg)){
        db.students.push({reg_no:reg, name, roll_no:roll, dept, email:"", emailVerified:true, status:"active"});
        added++;
      }
      if(secId && db.sections.find(s=>s.id===secId)){
        if(!db.enrollments.find(e=>e.student_reg_no===reg && e.section_id===secId)){
          db.enrollments.push({student_reg_no:reg, section_id:secId, joinedAt:todayISO()});
        }
      }
    });
    saveDB(db); renderRoster(); alert(`Imported ${added} student(s).`);
  };
  reader.readAsText(f);
};

// ---- render all accounts ----
function renderAccounts(){
  const box = $("accountList"); box.innerHTML = "";
  const db = loadDB();
  const all = [...db.students.map(s=>({...s, type:"student"})), ...db.teachers.map(t=>({...t, type:"teacher"}))];
  if(!all.length){ box.innerHTML = `<div class="muted small">None.</div>`; return; }
  all.forEach(a=>{
    const d = document.createElement("div");
    d.className = "rowline";
    let active = a.status==="active" && (a.type!=="teacher" || a.status!=="pending");
    d.innerHTML = `<span class="t">${esc(a.name||"")} <span class="s">${a.type} · ${esc(a.email||a.reg_no||"")} · ${a.status}</span></span>
      <span><button class="btn ${a.status==="active"?"danger":"ok"} small" data-act="${a.status==="active"?"deact":"act"}" data-id="${a.id||a.reg_no}" data-type="${a.type}">${a.status==="active"?"Deactivate":"Activate"}</button></span>`;
    d.querySelector('[data-act]').onclick = ()=>{
      const id = a.id||a.reg_no;
      if(a.type==="student"){
        const u = db.students.find(s=>s.reg_no===id); u.status = u.status==="active"?"inactive":"active";
      } else {
        const u = db.teachers.find(t=>t.id===id); u.status = u.status==="active"?"inactive":"active";
      }
      saveDB(db); renderAccounts(); renderTeachers(); renderPending();
    };
    box.appendChild(d);
  });
}

// ---- init ----
renderPending();
renderTeachers();
renderSections();
renderSubjects();
renderRoster();
renderAccounts();

// logout
const logoutBtn = document.createElement("button");
logoutBtn.className = "linklike";
logoutBtn.textContent = "Log out";
logoutBtn.onclick = ()=>{ clearSession(); location.href = "login.html"; };
document.querySelector("main .container").appendChild(Object.assign(document.createElement("p"),{className:"note"})).appendChild(logoutBtn);
