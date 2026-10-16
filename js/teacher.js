// Teacher workspace: subjects/topics CRUD, submissions, similarity, review queue, publish, CSV.
let db = loadDB();
let checked = new Set();
let pendingDelete = null;
const $ = id => document.getElementById(id);

// ---- subjects ----
function renderSubjects(){
  const box = $("subList"); box.innerHTML = "";
  const sel = $("topicSub"); sel.innerHTML = "";
  const fSub = $("fSub"); const curF = fSub.value; fSub.innerHTML = `<option value="">All subjects</option>`;
  const pubSub = $("pubSub"); const curP = pubSub.value; pubSub.innerHTML = "";
  db.subjects.forEach(s=>{
    const n = db.topics.filter(t=>t.subjectId===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline"; d.style.cursor = "default";
    d.innerHTML = `<span class="t">${esc(s.name)} <span class="s">${esc(s.code||"")} · ${n}</span></span>
      <span><button class="linklike" data-act="ren">Rename</button> · <button class="linklike" data-act="del">Delete</button></span>`;
    d.querySelector('[data-act="ren"]').onclick = ()=>{
      const v = prompt("New subject name:", s.name); if(!v) return;
      s.name = v.trim()||s.name; saveDB(db); renderAll();
    };
    d.querySelector('[data-act="del"]').onclick = ()=>{ pendingDelete=s.id; $("delName").textContent=s.name; $("delInput").value=""; $("delConfirm").disabled=true; $("delModal").classList.add("show"); };
    box.appendChild(d);
    const o = document.createElement("option"); o.value=s.id; o.textContent=s.name; sel.appendChild(o);
    const o2 = document.createElement("option"); o2.value=s.id; o2.textContent=s.name; fSub.appendChild(o2);
    const o3 = document.createElement("option"); o3.value=s.id; o3.textContent=s.name; pubSub.appendChild(o3);
  });
  if(curF) fSub.value = curF;
  if(curP) pubSub.value = curP;
}
$("addSubBtn").onclick = ()=>{
  const n = $("subName").value.trim(); if(!n){ alert("Enter subject name"); return; }
  db.subjects.push({id:"sub"+Date.now(), name:n, code:$("subCode").value.trim()});
  $("subName").value=""; $("subCode").value=""; saveDB(db); renderAll();
};
$("delCancel").onclick = ()=>$("delModal").classList.remove("show");
$("delInput").oninput = e=>{ $("delConfirm").disabled = e.target.value.trim()!=="delete"; };
$("delConfirm").onclick = ()=>{
  db.subjects = db.subjects.filter(s=>s.id!==pendingDelete);
  const tIds = db.topics.filter(t=>t.subjectId===pendingDelete).map(t=>t.id);
  db.topics = db.topics.filter(t=>t.subjectId!==pendingDelete);
  db.submissions = db.submissions.filter(s=>!tIds.includes(s.topicId));
  pendingDelete=null; $("delModal").classList.remove("show"); saveDB(db); renderAll();
};

// ---- topics ----
$("addTopicBtn").onclick = ()=>{
  const sid = $("topicSub").value; if(!sid){ alert("No subject"); return; }
  const title = $("topicTitle").value.trim(); if(!title){ alert("Enter topic title"); return; }
  db.topics.push({id:"t"+Date.now(), subjectId:sid, title,
    overview:$("topicOverview").value.trim()||"—", requirements:$("topicReq").value.trim()||"—",
    totalMarks:+$("topicMarks").value||20, deadline:$("topicDeadline").value||todayISO(),
    allowResubmit:$("topicResub").value==="yes"});
  $("topicTitle").value=""; $("topicOverview").value=""; $("topicReq").value="";
  saveDB(db); renderAll();
};
function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const fT = $("fTopic"); const cur = fT.value; fT.innerHTML = `<option value="">All topics</option>`;
  db.topics.forEach(t=>{
    const sub = db.subjects.find(s=>s.id===t.subjectId)?.name||"?";
    const o = document.createElement("option"); o.value=t.id; o.textContent=`${sub} — ${t.title}`; fT.appendChild(o);
  });
  if(cur) fT.value = cur;
  const grouped = {};
  db.topics.forEach(t=>{ (grouped[t.subjectId]=grouped[t.subjectId]||[]).push(t); });
  Object.entries(grouped).forEach(([sid, list])=>{
    const sub = db.subjects.find(s=>s.id===sid)?.name||"?";
    const h = document.createElement("h4"); h.textContent = sub; box.appendChild(h);
    list.forEach(t=>{
      const d = document.createElement("div");
      d.className = "topic";
      d.innerHTML = `<h4>${esc(t.title)}</h4>
        <p class="spec">${t.totalMarks} marks · ${esc(t.deadline||"")} · ${t.allowResubmit?'resubmit':'no resubmit'}</p>
        <p class="small muted">${esc(t.overview)}</p><p class="small muted">${esc(t.requirements)}</p>
        <div class="toolbar"><button class="linklike" data-a="e">Edit</button><button class="linklike" data-a="d">Delete</button></div>`;
      d.querySelector('[data-a="d"]').onclick = ()=>{
        if(!confirm(`Delete topic "${t.title}"? This removes its marks from view.`)) return;
        db.topics = db.topics.filter(x=>x.id!==t.id);
        db.submissions = db.submissions.filter(s=>s.topicId!==t.id);
        saveDB(db); renderAll();
      };
      d.querySelector('[data-a="e"]').onclick = ()=>{
        const nt = prompt("Title:", t.title); if(nt) t.title = nt;
        const nm = prompt("Total marks:", t.totalMarks); if(nm) t.totalMarks = +nm||t.totalMarks;
        const nd = prompt("Deadline YYYY-MM-DD:", t.deadline); if(nd) t.deadline = nd;
        saveDB(db); renderAll();
      };
      box.appendChild(d);
    });
  });
}

// ---- submissions ----
function filteredSubs(){
  const fs = $("fSub").value, ft = $("fTopic").value, q = $("fSearch").value.trim().toLowerCase();
  return db.submissions.filter(s=>
    (!fs || s.subjectId===fs) && (!ft || s.topicId===ft) &&
    (!q || (s.studentName+" "+s.rollNo+" "+s.regNo).toLowerCase().includes(q)));
}
function renderSubs(){
  const rows = filteredSubs();
  let h = `<tr><th></th><th>Student (roll / reg)</th><th>Subject → Topic</th><th>File</th><th>Flags</th><th>Marks</th><th>Actions</th></tr>`;
  rows.forEach(s=>{
    const sub = db.subjects.find(x=>x.id===s.subjectId)?.name||"?";
    const top = db.topics.find(x=>x.id===s.topicId)?.title||"?";
    const marks = s.teacherMarks!=null?s.teacherMarks:(s.aiMarks??"—");
    h += `<tr><td><input type="checkbox" data-id="${s.id}" ${checked.has(s.id)?"checked":""}></td>
      <td><b>${esc(s.studentName)}</b><br><span class="small muted">Roll ${esc(s.rollNo)} · ${esc(s.regNo)}</span></td>
      <td>${esc(sub)} → ${esc(top)}<br><span class="small muted">${esc(s.submittedAt)}</span></td>
      <td>${esc(s.fileName)}<br><span class="small muted">${esc(s.fileType)} · ${s.sizeKB}KB</span></td>
      <td>${s.late?'<span class="tag late">late</span>':""} ${s.ocrConfidence<80?`<span class="tag ocr">OCR ${s.ocrConfidence}%</span>`:""} ${s.similarityGroup?`<span class="tag sim">${esc(s.similarityGroup)} ${s.similarityPct}%</span>`:""} ${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td>
      <td>AI ${s.aiMarks??"—"} / T ${s.teacherMarks??"—"}</td>
      <td><button class="btn small" data-view="${s.id}">View</button> <button class="btn small" data-dl="${s.id}">Download</button></td></tr>`;
  });
  const tbl = $("subTable"); tbl.innerHTML = h || "<tr><td>No submissions.</td></tr>";
  tbl.querySelectorAll('input[type="checkbox"]').forEach(c=>c.onchange=()=>{ c.checked?checked.add(c.dataset.id):checked.delete(c.dataset.id); $("selCount").textContent = checked.size+" selected"; });
  tbl.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{
    const s = db.submissions.find(x=>x.id===b.dataset.view);
    const top = db.topics.find(x=>x.id===s.topicId);
    $("previewBox").textContent = `FILE: ${s.fileName} (${s.fileType}, ${s.sizeKB}KB)\nSTUDENT: ${s.studentName} | Roll ${s.rollNo} | ${s.regNo} | ${s.dept}\nTOPIC: ${top?.title} | Total ${top?.totalMarks}\nOCR confidence: ${s.ocrConfidence}%${s.ocrConfidence<80?" — FLAGGED YELLOW, check manually":""}\nFEEDBACK:\n` + (s.feedback||[]).map(f=>` - [${f.type}] ${f.text}${f.why?" (Why: "+f.why+")":""}`).join("\n") + `\n\n(Static mock — real in-browser rendering of PDF/images needs backend file URLs.)`;
  });
  tbl.querySelectorAll("[data-dl]").forEach(b=>b.onclick=()=>{
    const s = db.submissions.find(x=>x.id===b.dataset.dl);
    fakeDownload(s.fileName, `student ${s.studentName} roll ${s.rollNo}`);
  });
  $("selCount").textContent = checked.size+" selected";
}
["fSub","fTopic"].forEach(id=>$(id).addEventListener("change", renderSubs));
$("fSearch").addEventListener("input", renderSubs);
$("selAll").onclick = ()=>{ filteredSubs().forEach(s=>checked.add(s.id)); renderSubs(); };
$("selNone").onclick = ()=>{ checked.clear(); renderSubs(); };
$("bulkDl").onclick = ()=>{
  if(!checked.size){ alert("Select at least one row"); return; }
  const rows = db.submissions.filter(s=>checked.has(s.id));
  const manifest = rows.map(s=>`${s.studentName}, roll ${s.rollNo}, ${s.regNo}, ${s.fileName}`).join("\n");
  fakeDownload("bulk-selection.zip", manifest);
};

// ---- similarity ----
function renderSim(){
  const box = $("simGroups"); box.innerHTML = "";
  const groups = {};
  db.submissions.filter(s=>s.similarityGroup).forEach(s=>{ (groups[s.similarityGroup]=groups[s.similarityGroup]||[]).push(s); });
  if(!Object.keys(groups).length){ box.innerHTML = `<div class="muted small">Empty.</div>`; return; }
  Object.entries(groups).forEach(([g, list], i)=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(g)} — ${list.length} grouped</h4>
      <table><tr><th>Student</th><th>File</th><th>Matches</th><th>Similarity</th></tr>${list.map(s=>{
        const names = s.similarityWith.map(id=>{ const o=db.submissions.find(x=>x.id===id); return o?`${esc(o.studentName)} (roll ${esc(o.rollNo)})`:id; }).join(", ")||"—";
        return `<tr><td><b>${esc(s.studentName)}</b> roll ${esc(s.rollNo)}</td><td>${esc(s.fileName)}</td><td>${names}</td><td><b>${s.similarityPct}%</b></td></tr>`;
      }).join("")}</table>
      <p class="small muted">Teacher action: open Review Queue → override / publish per student.</p>`;
    box.appendChild(d);
  });
}

// ---- review queue + grade editor ----
function renderReview(){
  const box = $("reviewList");
  const q = [...db.submissions].sort((a,b)=>a.ocrConfidence-b.ocrConfidence);
  const sel = $("gradeSub"); sel.innerHTML = "";
  if(!q.length){ box.innerHTML = `<div class="muted">Queue empty.</div>`; return; }
  box.innerHTML = `<table><tr><th>Priority</th><th>Submission</th><th>OCR</th><th>AI marks</th><th>Status</th></tr>` + q.map((s,i)=>{
    const o = document.createElement("option"); o.value=s.id; o.textContent=`${s.studentName} (roll ${s.rollNo}) — ${s.fileName} — AI ${s.aiMarks??"—"}`; sel.appendChild(o);
    return `<tr><td>#${i+1}</td><td><b>${esc(s.studentName)}</b> roll ${esc(s.rollNo)} · ${esc(s.fileName)}</td>
      <td>${s.ocrConfidence<80?`<span class="tag ocr">${s.ocrConfidence}% check</span>`:s.ocrConfidence+"%"}</td>
      <td>${s.aiMarks??"—"}</td><td>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}</td></tr>`;
  }).join("") + "</table>";
}
$("saveGrade").onclick = ()=>{
  const s = db.submissions.find(x=>x.id===$("gradeSub").value); if(!s) return;
  const v = $("gradeMarks").value;
  if(v!=="" && v!=null) s.teacherMarks = +v;
  const fb = $("gradeFb").value.trim();
  if(fb) s.feedback = s.feedback.concat([{type:"wrong", text:fb, why:"Teacher override note."}]);
  saveDB(db); $("gradeMsg").innerHTML = `<div class="alert ok">Saved for ${esc(s.studentName)} (still unpublished until you publish).</div>`;
  renderAll();
};

// ---- publish + csv ----
function renderPublish(){
  const sid = $("pubSub").value || db.subjects[0]?.id;
  if(sid && !$("pubSub").value) $("pubSub").value = sid;
  const rows = db.submissions.filter(s=>s.subjectId===sid);
  let h = `<tr><th>Student</th><th>Roll / Reg</th><th>Topic</th><th>AI / Teacher</th><th>Published</th><th>Action</th></tr>`;
  rows.forEach(s=>{
    const top = db.topics.find(x=>x.id===s.topicId)?.title||"?";
    h += `<tr><td>${esc(s.studentName)}</td><td>${esc(s.rollNo)} / ${esc(s.regNo)}</td><td>${esc(top)}</td>
      <td>${s.aiMarks??"—"} / ${s.teacherMarks??"—"}</td>
      <td>${s.published?'<span class="tag pub">yes</span>':'<span class="tag unpub">no</span>'}</td>
      <td><button class="btn small ${s.published?"":"ok"}" data-pub="${s.id}">${s.published?"Unpublish":"Publish"}</button></td></tr>`;
  });
  $("pubTable").innerHTML = h;
  $("pubTable").querySelectorAll("[data-pub]").forEach(b=>b.onclick=()=>{
    const s = db.submissions.find(x=>x.id===b.dataset.pub);
    s.published = !s.published;
    if(s.published && s.teacherMarks==null && s.aiMarks!=null) s.teacherMarks = s.aiMarks; // publish carries effective marks
    if(s.published && $("notifyToggle").checked) alert(`(Static demo) Email would be sent to ${s.studentName} — real email needs backend.`);
    saveDB(db); renderAll();
  });
}
$("pubSub").addEventListener("change", renderPublish);
$("pubAll").onclick = ()=>{
  const sid = $("pubSub").value; let n=0;
  db.submissions.filter(s=>s.subjectId===sid).forEach(s=>{ s.published=true; if(s.teacherMarks==null&&s.aiMarks!=null)s.teacherMarks=s.aiMarks; n++; });
  saveDB(db); renderAll(); alert(`Published ${n} submission(s).${$("notifyToggle").checked?" (Demo) emails would be sent — backend required.":""}`);
};
$("unpubAll").onclick = ()=>{
  const sid = $("pubSub").value;
  db.submissions.filter(s=>s.subjectId===sid).forEach(s=>s.published=false);
  saveDB(db); renderAll();
};
$("csvBtn").onclick = ()=>{
  const sid = $("pubSub").value;
  const sub = db.subjects.find(s=>s.id===sid);
  const rows = [["Name","Roll No","Registration No","Department","Topic","File","AI Marks","Teacher Marks","Published","Late","Similarity Group"]];
  db.submissions.filter(s=>s.subjectId===sid).forEach(s=>{
    const top = db.topics.find(x=>x.id===s.topicId)?.title||"";
    rows.push([s.studentName,s.rollNo,s.regNo,s.dept,top,s.fileName,s.aiMarks??"",s.teacherMarks??"",s.published?"yes":"no",s.late?"late":"on-time",s.similarityGroup||""]);
  });
  downloadCSV(`${sub?.name||"subject"}-marks.csv`, rows);
};

$("resetBtn").onclick = ()=>{ db = resetDB(); checked.clear(); renderAll(); };

function renderAll(){ renderSubjects(); renderTopics(); renderSubs(); renderSim(); renderReview(); renderPublish(); }
renderAll();
