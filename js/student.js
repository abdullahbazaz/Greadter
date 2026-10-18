// Student workspace — live API backend (Neon via Vercel)
const API_BASE = "https://projectgreadter.vercel.app/api";

const $ = id => document.getElementById(id);

let session = null;
let selectedSubject = null;
let selectedTopic = null;
let selectedCustomTopic = null;
let stagedFiles = [];

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (session && session.token) headers.Authorization = "Bearer " + session.token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (res.status === 401) { location.href = "login.html?role=student"; return null; }
  return res.json();
}

async function init() {
  const raw = localStorage.getItem("greadter_session_v1");
  if (!raw) { location.href = "login.html?role=student"; return; }
  session = JSON.parse(raw);
  if (session.userType !== "student") { location.href = "login.html?role=teacher"; return; }

  const me = await api("/me");
  if (!me || !me.ok) { localStorage.removeItem("greadter_session_v1"); location.href = "login.html?role=student"; return; }

  await loadSubjects();
  renderAll();
}

function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

async function loadSubjects() {
  const data = await api("/subjects");
  if (!data) return;
  window.allSubjects = data.subjects || [];
  renderSubjects();
}

function renderSubjects(){
  const g = $("subjectGrid"); g.innerHTML = "";
  const subs = window.allSubjects || [];
  if(!subs.length){ g.innerHTML = `<div class="muted small">No subjects available.</div>`; return; }
  if(!selectedSubject || !subs.some(s=>s.id===selectedSubject)) selectedSubject = subs[0].id;
  subs.forEach(s=>{
    const d = document.createElement("div");
    d.className = "rowline" + (s.id===selectedSubject?" sel":"");
    d.innerHTML = `<span class="t">${esc(s.name)}</span><span class="s">${esc(s.code||"")}</span>`;
    d.onclick = ()=>{ selectedSubject=s.id; selectedTopic=null; selectedCustomTopic=null; renderAll(); };
    g.appendChild(d);
  });
}

async function renderTopics(){
  const box = $("topicList"); box.innerHTML = "";
  const sub = window.allSubjects.find(s=>s.id===selectedSubject);
  if(!sub){ box.innerHTML = `<div class="muted small">Select a subject.</div>`; return; }
  const mode = sub.assignment_mode || "single";

  const badge = document.createElement("div");
  badge.className = "small muted";
  badge.style.marginBottom = "8px";
  badge.textContent = mode === "single" ? "Single topic mode" : mode === "multiple" ? "Choose a topic" : "Custom topics allowed";
  box.appendChild(badge);

  const data = await api(`/topics?subject_id=${selectedSubject}`);
  const topics = data && data.topics ? data.topics : [];

  if(mode === "single"){
    if(!topics.length){ box.innerHTML += `<div class="muted small">No topic yet.</div>`; return; }
    if(!selectedTopic || !topics.some(t=>t.id===selectedTopic)) selectedTopic = topics[0].id;
    const t = topics.find(x=>x.id===selectedTopic);
    const card = document.createElement("div");
    card.className = "topic sel";
    card.innerHTML = `<h4>${esc(t.title)}</h4>
      <p class="spec">${t.total_marks} marks · ${t.deadline||"—"}</p>
      <p class="small muted">${esc(t.overview||"")}</p>
      <p class="small muted">${esc(t.requirements||"")}</p>`;
    box.appendChild(card);
  } else if(mode === "multiple"){
    if(!topics.length){ box.innerHTML += `<div class="muted small">No topics yet.</div>`; }
    topics.forEach(t=>{
      const card = document.createElement("div");
      card.className = "topic" + (t.id===selectedTopic?" sel":"");
      card.innerHTML = `<h4>${esc(t.title)}</h4>
        <p class="spec">${t.total_marks} marks · ${t.deadline||"—"}</p>
        <p class="small muted">${esc(t.overview||"")}</p>
        <p class="small muted">${esc(t.requirements||"")}</p>
        <button class="linklike">Select ›</button>`;
      card.querySelector("button").onclick = ()=>{ selectedTopic=t.id; selectedCustomTopic=null; renderAll(); };
      box.appendChild(card);
    });
    if(selectedTopic && topics.some(t=>t.id===selectedTopic)) {}
    else { selectedTopic = topics[0]?.id || null; }
  } else if(mode === "custom"){
    if(topics.length){
      const h = document.createElement("h4"); h.textContent = "Teacher topics"; box.appendChild(h);
      topics.forEach(t=>{
        const card = document.createElement("div");
        card.className = "topic" + (t.id===selectedTopic?" sel":"");
        card.innerHTML = `<h4>${esc(t.title)}</h4>
          <p class="spec">${t.total_marks} marks</p>
          <p class="small muted">${esc(t.requirements||"")}</p>
          <button class="linklike">Select ›</button>`;
        card.querySelector("button").onclick = ()=>{ selectedTopic=t.id; selectedCustomTopic=null; renderAll(); };
        box.appendChild(card);
      });
    }
    if(selectedCustomTopic){
      const active = document.createElement("div");
      active.className = "topic sel";
      active.innerHTML = `<h4>Your topic: ${esc(selectedCustomTopic.title)}</h4>
        <p class="spec">Custom topic</p>
        <p class="small muted">${esc(selectedCustomTopic.summary)}</p>
        <button class="linklike" id="clearCustomTopic">Use teacher topic instead</button>`;
      active.querySelector("#clearCustomTopic").onclick = ()=>{ selectedCustomTopic=null; selectedTopic=null; renderAll(); };
      box.appendChild(active);
    }
    const form = document.createElement("div");
    form.className = "topic";
    form.innerHTML = `<h4>Create your own topic</h4>
      <input id="customTopicTitle" placeholder="Topic title">
      <textarea id="customTopicSummary" rows="2" placeholder="Describe your assignment"></textarea>
      <div class="toolbar"><button class="btn primary" id="createCustomTopicBtn">Create topic</button></div>`;
    box.appendChild(form);
    $("createCustomTopicBtn").onclick = async ()=>{
      const title = $("customTopicTitle").value.trim();
      const summary = $("customTopicSummary").value.trim();
      if(!title || !summary){ $("uploadMsg").innerHTML = `<div class="alert bad">Title and summary required.</div>`; return; }
      const res = await api("/custom_topics", {
        method: "POST",
        body: JSON.stringify({ subject_id: selectedSubject, student_reg_no: session.userId, title, summary })
      });
      if(res && res.ok){
        selectedCustomTopic = { id: res.id, title, summary };
        selectedTopic = null;
        $("customTopicTitle").value=""; $("customTopicSummary").value="";
        renderAll();
      } else {
        $("uploadMsg").innerHTML = `<div class="alert bad">Failed to create custom topic.</div>`;
      }
    };
  }
  renderUploadInfo();
}

function renderUploadInfo(){
  const sub = window.allSubjects.find(s=>s.id===selectedSubject);
  const mode = sub ? sub.assignment_mode || "single" : "single";
  let info = ""; let canUpload = false;
  if(mode === "custom" && selectedCustomTopic){
    info = `Custom topic: <b>${esc(selectedCustomTopic.title)}</b>`;
    canUpload = stagedFiles.length > 0;
  } else if(selectedTopic){
    info = `Topic selected`;
    canUpload = stagedFiles.length > 0;
  } else {
    info = mode === "single" ? "Topic auto-selected." : "Pick a topic.";
  }
  $("uploadTopicInfo").innerHTML = info || `Pick a topic.`;
  $("uploadBtn").disabled = !canUpload;
}

function stageFiles(fileList){
  $("uploadMsg").innerHTML = "";
  const ALLOWED_EXT = ["pdf","doc","docx","ppt","pptx","txt","odt","rtf"];
  const MAX_MB = 25;
  [...fileList].forEach(f=>{
    const ext = f.name.split(".").pop().toLowerCase();
    const mb = f.size/1024/1024;
    if(!ALLOWED_EXT.includes(ext)){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: .${esc(ext)} not allowed.</div>`; return; }
    if(mb > MAX_MB){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: exceeds ${MAX_MB}MB limit.</div>`; return; }
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

async function doUpload(){
  const sub = window.allSubjects.find(s=>s.id===selectedSubject);
  const mode = sub ? sub.assignment_mode || "single" : "single";
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

  const now = new Date().toISOString().slice(0,19).replace("T"," ");
  const late = false; // server-side can compute properly later

  for(const f of stagedFiles){
    await api("/submissions", {
      method: "POST",
      body: JSON.stringify({
        subject_id: selectedSubject, topicId: topicId, topicType: topicType,
        student_name: nm, roll_no: rl, reg_no: rg, dept: dp,
        file_name: f.name, file_type: f.type, size_kb: f.sizeKB,
        submitted_at: now, late: late,
        ai_marks: null, teacher_marks: null, published: false,
        similarity_group: null, similarity_pct: null, feedback: []
      })
    });
  }
  saveMine(); stagedFiles=[]; renderFileList();
  $("uploadMsg").innerHTML = `<div class="alert ok">Uploaded.</div>`;
  renderAll();
}

async function saveMine(){
  // track uploaded submission ids locally for "my files" view
  const data = await api(`/submissions?reg_no=${session.userId}`);
  if(data && data.submissions){
    const ids = data.submissions.map(s=>s.id);
    try{ localStorage.setItem("greadter_mine_v1", JSON.stringify([...new Set(ids)])); }catch(e){}
  }
}

function getMine(){ try{ return JSON.parse(localStorage.getItem("greadter_mine_v1")||"[]"); }catch(e){ return []; } }

async function renderMarksheet(){
  const box = $("marksheet"); box.innerHTML = "";
  const ids = new Set(getMine());
  const data = await api(`/submissions?reg_no=${session.userId}`);
  const subs = (data && data.submissions) || [];
  const mine = subs.filter(s=>ids.has(s.id) && s.published && s.teacher_marks!=null);
  if(!mine.length){ box.innerHTML = `<div class="muted small">No published marks yet.</div>`; return; }
  let rows = `<table><tr><th>Subject</th><th>Topic</th><th>File</th><th>Marks</th><th>Status</th></tr>`;
  mine.forEach(s=>{
    rows += `<tr><td>${esc(s.subject_name||"")}</td><td>${esc(s.topic_title||"")}</td><td>${esc(s.file_name)}</td><td><b>${s.teacher_marks}</b></td><td><span class="tag pub">published</span>${s.late?' <span class="tag late">late</span>':""}</td></tr>`;
  });
  box.innerHTML = rows + "</table>";
}

function feedbackHTML(fb){
  if(!fb || !fb.length) return "";
  return fb.map(f=>{
    const cls = f.type==="wrong"?"feedback-wrong":f.type==="low"?"feedback-low":"feedback-ok";
    return `<div class="${cls}"><b>${f.type==="wrong"?"✘ Needs correction":f.type==="low"?"⚠ Low-confidence":"✔ Good"}</b><div>${esc(f.text)}</div>${f.why?`<div class="small"><b>Why:</b> ${esc(f.why)}</div>`:""}</div>`;
  }).join("");
}

async function renderMySubs(){
  const box = $("mySubs"); box.innerHTML = "";
  const ids = new Set(getMine());
  const data = await api(`/submissions?reg_no=${session.userId}`);
  const subs = (data && data.submissions) || [];
  const mine = subs.filter(s=>ids.has(s.id)).slice().reverse();
  if(!mine.length){ box.innerHTML = `<div class="muted small">Nothing yet.</div>`; return; }
  mine.forEach(s=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(s.file_name)}</h4>
      <p class="spec">${esc(s.subject_name||"")} → ${esc(s.topic_title||"")} · ${s.submitted_at} · ${s.published&&s.teacher_marks!=null?s.teacher_marks:"hidden"}</p>
      <div>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}
      ${s.late?'<span class="tag late">late submission</span>':""}</div>
      <div style="margin-top:8px">${feedbackHTML(s.feedback||[])}</div>`;
    box.appendChild(d);
  });
}

function renderAll(){ renderSubjects(); renderTopics(); renderFileList(); renderUploadInfo(); renderMarksheet(); renderMySubs(); }

$("fileInput").addEventListener("change", e=>stageFiles(e.target.files));
const dz = $("dropZone");
dz.onclick = ()=>$("fileInput").click();
["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("dragover");}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("dragover");}));
dz.addEventListener("drop", e=>stageFiles(e.dataTransfer.files));
$("uploadBtn").onclick = doUpload;

const logoutBtn = document.createElement("button");
logoutBtn.className = "linklike";
logoutBtn.textContent = "Log out";
logoutBtn.onclick = ()=>{ fetch(API_BASE+"/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:session.token})}); localStorage.removeItem("greadter_session_v1"); location.href = "login.html"; };
document.querySelector("main .container").appendChild(Object.assign(document.createElement("p"),{className:"note"})).appendChild(logoutBtn);

init();
