// Student workspace: subject select -> topic select -> upload -> dashboard (published only) + feedback.
// Requires login.
const db = loadDB();
const session = getSession();
if(!session || session.userType !== "student"){
  location.href = "login.html?role=student";
}
let selectedSubject = db.subjects[0]?.id || null;
let selectedTopic = null;
let selectedCustomTopic = null;
let stagedFiles = [];

const $ = id => document.getElementById(id);

function renderSubjects(){
  const g = $("subjectGrid"); g.innerHTML = "";
  if(!db.subjects.length){ g.innerHTML = `<div class="muted small">Empty.</div>`; return; }
  if(!db.subjects.some(s=>s.id===selectedSubject)) selectedSubject = db.subjects[0].id;
  db.subjects.forEach(s=>{
    const count = db.topics.filter(t=>t.subjectId===s.id).length;
    const d = document.createElement("div");
    d.className = "rowline" + (s.id===selectedSubject?" sel":"");
    d.innerHTML = `<span class="t">${esc(s.name)}</span><span class="s">${esc(s.code||"")} · ${count}</span>`;
    d.onclick = ()=>{ selectedSubject=s.id; selectedTopic=null; renderAll(); };
    g.appendChild(d);
  });
}
function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const sub = db.subjects.find(s=>s.id===selectedSubject);
  const mode = sub?.mode || "single";
  const topics = db.topics.filter(t=>t.subjectId===selectedSubject);
  const sel = $("topicSelect"); sel.innerHTML = "";

  const badge = document.createElement("div");
  badge.className = "small muted";
  badge.style.marginBottom = "8px";
  badge.textContent = mode === "single" ? "Single topic mode" : mode === "multiple" ? "Choose a topic" : "Custom topics allowed";
  box.appendChild(badge);

  if(mode === "single"){
    if(!topics.length){ box.innerHTML += `<div class="muted small">No topic yet. Ask your teacher.</div>`; return; }
    if(!selectedTopic || !topics.some(t=>t.id===selectedTopic)) selectedTopic = topics[0].id;
    const t = topics.find(x=>x.id===selectedTopic);
    const late = todayISO() > t.deadline;
    const card = document.createElement("div");
    card.className = "topic sel";
    card.innerHTML = `<h4>${esc(t.title)}</h4>
      <p class="spec">${t.totalMarks} marks · ${esc(t.deadline||"—")}${late?' · past deadline':""}</p>
      <p class="small muted">${esc(t.overview)}</p>
      <p class="small muted">${esc(t.requirements)}</p>`;
    box.appendChild(card);
    sel.value = selectedTopic;
  } else if(mode === "multiple"){
    if(!topics.length){ box.innerHTML += `<div class="muted small">No topics yet.</div>`; }
    topics.forEach(t=>{
      const late = todayISO() > t.deadline;
      const card = document.createElement("div");
      card.className = "topic" + (t.id===selectedTopic?" sel":"");
      card.innerHTML = `<h4>${esc(t.title)}</h4>
        <p class="spec">${t.totalMarks} marks · ${esc(t.deadline||"—")}${late?' · past deadline':""}</p>
        <p class="small muted">${esc(t.overview)}</p>
        <p class="small muted">${esc(t.requirements)}</p>
        <button class="linklike">Select ›</button>`;
      card.querySelector("button").onclick = ()=>{ selectedTopic=t.id; selectedCustomTopic=null; renderAll(); };
      box.appendChild(card);
      const o = document.createElement("option");
      o.value=t.id; o.textContent=`${t.title} (${t.totalMarks} marks)`; sel.appendChild(o);
    });
    if(selectedTopic && topics.some(t=>t.id===selectedTopic)) sel.value = selectedTopic;
    else { selectedTopic = topics[0]?.id || null; if(selectedTopic) sel.value = selectedTopic; }
    sel.onchange = ()=>{ selectedTopic = sel.value; selectedCustomTopic=null; renderTopics(); renderUploadInfo(); };
  } else if(mode === "custom"){
    if(topics.length){
      const h = document.createElement("h4"); h.textContent = "Teacher topics"; box.appendChild(h);
      topics.forEach(t=>{
        const card = document.createElement("div");
        card.className = "topic" + (t.id===selectedTopic?" sel":"");
        card.innerHTML = `<h4>${esc(t.title)}</h4>
          <p class="spec">${t.totalMarks} marks</p>
          <p class="small muted">${esc(t.requirements)}</p>
          <button class="linklike">Select ›</button>`;
        card.querySelector("button").onclick = ()=>{ selectedTopic=t.id; selectedCustomTopic=null; renderAll(); };
        box.appendChild(card);
      });
    }
    if(selectedCustomTopic){
      const ct = db.custom_topics.find(x=>x.id===selectedCustomTopic.id);
      if(ct){
        const active = document.createElement("div");
        active.className = "topic sel";
        active.innerHTML = `<h4>Your topic: ${esc(ct.title)}</h4>
          <p class="spec">Custom topic · ${ct.summary.length} chars summary</p>
          <p class="small muted">${esc(ct.summary)}</p>
          <button class="linklike" id="clearCustomTopic">Use teacher topic instead</button>`;
        active.querySelector("#clearCustomTopic").onclick = ()=>{ selectedCustomTopic=null; selectedTopic=null; renderAll(); };
        box.appendChild(active);
      }
    }
    const form = document.createElement("div");
    form.className = "topic";
    form.innerHTML = `<h4>Create your own topic</h4>
      <input id="customTopicTitle" placeholder="Topic title">
      <textarea id="customTopicSummary" rows="2" placeholder="Describe your assignment (AI grades against this)"></textarea>
      <div class="toolbar"><button class="btn primary" id="createCustomTopicBtn">Create topic</button></div>`;
    box.appendChild(form);
    $("createCustomTopicBtn").onclick = ()=>{
      const title = $("customTopicTitle").value.trim();
      const summary = $("customTopicSummary").value.trim();
      if(!title || !summary){ $("uploadMsg").innerHTML = `<div class="alert bad">Title and summary required.</div>`; return; }
      const id = "ct"+Date.now();
      db.custom_topics.push({id, subjectId:selectedSubject, studentRegNo:$("stuReg").value.trim(), title, summary, createdAt:todayISO()});
      selectedCustomTopic = {id, title, summary};
      selectedTopic = null;
      $("customTopicTitle").value=""; $("customTopicSummary").value="";
      saveDB(db); renderAll();
    };
  }
  renderUploadInfo();
}
function renderUploadInfo(){
  const sub = db.subjects.find(s=>s.id===selectedSubject);
  const mode = sub?.mode || "single";
  let info = ""; let canUpload = false;
  if(mode === "custom" && selectedCustomTopic){
    info = `Custom topic: <b>${esc(selectedCustomTopic.title)}</b> · ${esc(selectedCustomTopic.summary.slice(0,60))}${selectedCustomTopic.summary.length>60?"…":""}`;
    canUpload = stagedFiles.length > 0;
  } else if(selectedTopic){
    const t = db.topics.find(x=>x.id===selectedTopic);
    info = t ? `${esc(t.title)} · ${t.totalMarks} · ${esc(t.deadline||"—")} ${todayISO()>t.deadline?'<span class="tag late">late</span>':""}` : "";
    canUpload = t && stagedFiles.length > 0;
  } else {
    info = mode === "single" ? "Topic auto-selected." : "Pick a topic.";
  }
  $("uploadTopicInfo").innerHTML = info || `Pick a topic.`;
  $("uploadBtn").disabled = !canUpload;
}
function stageFiles(fileList){
  $("uploadMsg").innerHTML = "";
  [...fileList].forEach(f=>{
    const ext = extOf(f.name);
    const mb = f.size/1024/1024;
    if(!ALLOWED_EXT.includes(ext)){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: .${esc(ext)} not allowed.</div>`; return; }
    if(mb > MAX_MB){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: ${mb.toFixed(1)}MB exceeds ${MAX_MB}MB limit.</div>`; return; }
    stagedFiles.push({name:f.name, type:ext, sizeKB:Math.round(f.size/1024)});
  });
  renderFileList(); renderUploadInfo();
}
function renderFileList(){
  $("fileList").innerHTML = stagedFiles.length
    ? stagedFiles.map((f,i)=>`${i+1}. ${esc(f.name)} (${esc(f.type)}, ${f.sizeKB}KB) <a href="#" data-i="${i}">remove</a>`).join("<br>")
    : "No files staged.";
  $("fileList").querySelectorAll("a").forEach(a=>a.onclick=e=>{e.preventDefault(); stagedFiles.splice(+a.dataset.i,1); renderFileList(); renderUploadInfo();});
}
function doUpload(){
  const sub = db.subjects.find(s=>s.id===selectedSubject);
  const mode = sub?.mode || "single";
  let topicId = selectedTopic;
  let topicType = "teacher";
  if(mode === "custom" && selectedCustomTopic){
    topicId = selectedCustomTopic.id;
    topicType = "custom";
  }
  if(!topicId || !stagedFiles.length) return;
  const nm = $("stuName").value.trim(), rl = $("stuRoll").value.trim(),
        rg = $("stuReg").value.trim(), dp = $("stuDept").value.trim();
  if(!nm || !rl || !rg){ $("uploadMsg").innerHTML = `<div class="alert bad">Name, roll, reg. required.</div>`; return; }
  const now = todayISO();
  let deadline = null;
  if(topicType === "teacher"){
    const tp = db.topics.find(x=>x.id===topicId);
    deadline = tp?.deadline || null;
  }
  const late = deadline ? isLate(deadline, now) : false;
  const ids = [];
  stagedFiles.forEach((f,idx)=>{
    const id = "s"+Date.now()+idx; ids.push(id);
    db.submissions.push({
      id, studentName:nm, rollNo:rl, regNo:rg, dept:dp,
      subjectId:selectedSubject, topicId:topicId, topicType:topicType, fileName:f.name, fileType:f.type, sizeKB:f.sizeKB,
      submittedAt:now, late, ocrConfidence: 99,
      aiMarks:null, teacherMarks:null, published:false,
      similarityGroup:null, similarityWith:[], similarityPct:0,
      feedback:[{type:"ok",text:"Uploaded. Awaiting grading and teacher review."}]
    });
  });
  saveDB(db); addMine(ids); stagedFiles=[]; renderFileList();
  $("uploadMsg").innerHTML = `<div class="alert ok">Uploaded.</div>`;
  renderAll();
}
function renderMarksheet(){
  const box = $("marksheet");
  const ids = new Set(getMine());
  const mine = db.submissions.filter(s=>ids.has(s.id) && s.published && s.teacherMarks!=null);
  if(!mine.length){ box.innerHTML = `<div class="muted small">Empty.</div>`; return; }
  let rows = `<table><tr><th>Subject</th><th>Topic</th><th>File</th><th>Marks</th><th>Status</th></tr>`;
  mine.forEach(s=>{
    const sub = db.subjects.find(x=>x.id===s.subjectId)?.name || "?";
    const top = db.topics.find(x=>x.id===s.topicId)?.title || "?";
    const total = db.topics.find(x=>x.id===s.topicId)?.totalMarks || "?";
    rows += `<tr><td>${esc(sub)}</td><td>${esc(top)}</td><td>${esc(s.fileName)}</td><td><b>${s.teacherMarks} / ${total}</b></td><td><span class="tag pub">published</span>${s.late?' <span class="tag late">late</span>':""}</td></tr>`;
  });
  box.innerHTML = rows + "</table>";
}
function feedbackHTML(fb){
  return fb.map(f=>{
    const cls = f.type==="wrong"?"feedback-wrong":f.type==="low"?"feedback-low":"feedback-ok";
    return `<div class="${cls}"><b>${f.type==="wrong"?"✘ Needs correction":f.type==="low"?"⚠ Low-confidence / needs review":"✔ Good"}</b><div>${esc(f.text)}</div>${f.why?`<div class="small"><b>Why:</b> ${esc(f.why)}</div>`:""}</div>`;
  }).join("");
}
function renderMySubs(){
  const box = $("mySubs"); box.innerHTML = "";
  const ids = new Set(getMine());
  const mine = db.submissions.filter(s=>ids.has(s.id)).slice().reverse();
  if(!mine.length){ box.innerHTML = `<div class="muted small">Empty.</div>`; return; }
  mine.forEach(s=>{
    const sub = db.subjects.find(x=>x.id===s.subjectId)?.name || "?";
    const top = s.topicType === "custom"
      ? (db.custom_topics.find(x=>x.id===s.topicId)?.title || "Custom topic")
      : (db.topics.find(x=>x.id===s.topicId)?.title || "?");
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(s.fileName)}</h4>
      <p class="spec">${esc(sub)} → ${esc(top)} · ${esc(s.submittedAt)} · ${s.published&&s.teacherMarks!=null?s.teacherMarks:"hidden"}</p>
      <div>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}
      ${s.late?'<span class="tag late">late submission</span>':""}
      ${s.ocrConfidence<80?`<span class="tag ocr">OCR ${s.ocrConfidence}% — manual check</span>`:""}
      ${s.similarityGroup?`<span class="tag sim">similarity ${esc(s.similarityGroup)} (${s.similarityPct}%)</span>`:""}</div>
      <div class="small muted">Submitted ${esc(s.submittedAt)} · shown marks: <b>${s.published&&s.teacherMarks!=null?s.teacherMarks:"hidden"}</b></div>
      <div style="margin-top:8px">${feedbackHTML(s.feedback||[])}</div>`;
    box.appendChild(d);
  });
}
function renderAll(){ renderSubjects(); renderTopics(); renderFileList(); renderMarksheet(); renderMySubs(); }

$("fileInput").addEventListener("change", e=>stageFiles(e.target.files));
$("topicSelect").addEventListener("change", ()=>{});
const dz = $("dropZone");
dz.onclick = ()=>$("fileInput").click();
["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("dragover");}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("dragover");}));
dz.addEventListener("drop", e=>stageFiles(e.dataTransfer.files));
$("uploadBtn").onclick = doUpload;
$("resetBtn").onclick = ()=>{ db = resetDB(); clearMine(); selectedSubject=db.subjects[0]?.id||null; selectedTopic=null; selectedCustomTopic=null; stagedFiles=[]; renderAll(); };
renderAll();

// logout
const logoutBtn = document.createElement("button");
logoutBtn.className = "linklike";
logoutBtn.textContent = "Log out";
logoutBtn.onclick = ()=>{ clearSession(); location.href = "login.html"; };
document.querySelector("main .container").appendChild(Object.assign(document.createElement("p"),{className:"note"})).appendChild(logoutBtn);
