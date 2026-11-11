// Student workspace — live API backend (Neon via Vercel). Requires js/auth.js.
const ALLOWED_EXT = ["pdf","doc","docx","ppt","pptx","txt","odt","rtf"];
const MAX_MB = 25;

const session = requirePageRole("student");
let me = null;
let allSubjects = [];
let mySubs = [];               // fetched once, refreshed after each upload
const topicCache = {};         // subject_id -> topics, so clicking around does not refetch
let selectedSubject = null;
let selectedTopic = null;
let selectedCustomTopic = null;
let stagedFiles = [];
let uploading = false;

async function init(){
  if(!session) return;
  const [meRes, subjRes] = await Promise.all([api("/me"), api("/subjects"), refreshSubs()]);
  if(!meRes || !meRes.ok){ clearSession(); location.replace(LOGIN_PAGE.student); return; }
  me = meRes.user;
  // Identity fields are filled from the account (the server ignores typed values anyway).
  $("stuName").value = me.name || "";
  $("stuRoll").value = me.roll_no || "";
  $("stuReg").value = me.reg_no || "";
  if(me.dept) $("stuDept").value = me.dept;
  allSubjects = (subjRes && subjRes.subjects) || [];
  renderAll();
}

async function refreshSubs(){
  const data = await api("/submissions");
  mySubs = (data && data.submissions) || [];
  renderMarksheet(); renderMySubs();
}

async function getTopics(subjectId){
  if(!topicCache[subjectId]){
    const data = await api(`/topics?subject_id=${encodeURIComponent(subjectId)}`);
    topicCache[subjectId] = (data && data.topics) || [];
  }
  return topicCache[subjectId];
}

function renderSubjects(){
  const g = $("subjectGrid"); g.innerHTML = "";
  if(!allSubjects.length){
    // No section yet: let the student join one with the code their teacher/admin gave them.
    g.innerHTML = `<div class="muted small">You are not in a section with subjects yet. Enter the join code from your teacher or admin.</div>
      <input id="joinCode" placeholder="Join code (e.g. GC1A2B3C4D)" autocomplete="off">
      <div class="toolbar"><button class="btn primary" id="joinBtn">Join section</button></div>`;
    $("joinBtn").onclick = async ()=>{
      const code = $("joinCode").value.trim(); if(!code) return;
      const r = await api("/enroll", { method:"POST", body: JSON.stringify({ join_code: code }) });
      if(!r) return;
      if(!r.ok){ alert(r.error || "Could not join"); return; }
      const s = await api("/subjects");
      allSubjects = (s && s.subjects) || [];
      renderAll();
    };
    return;
  }
  if(!selectedSubject || !allSubjects.some(s=>s.id===selectedSubject)) selectedSubject = allSubjects[0].id;
  allSubjects.forEach(s=>{
    const d = document.createElement("div");
    d.className = "rowline" + (s.id===selectedSubject?" sel":"");
    d.innerHTML = `<span class="t">${esc(s.name)}</span><span class="s">${esc(s.code||"")}</span>`;
    d.onclick = ()=>{ selectedSubject=s.id; selectedTopic=null; selectedCustomTopic=null; renderAll(); };
    g.appendChild(d);
  });
}

function topicCard(t, {selectable, showOverview=true}){
  const card = document.createElement("div");
  card.className = "topic" + (t.id===selectedTopic?" sel":"");
  card.innerHTML = `<h4>${esc(t.title)}</h4>
    <p class="spec">${esc(t.total_marks ?? "—")} marks${t.deadline?`, due ${esc(fmtDate(t.deadline))}`:""}</p>
    ${showOverview?`<p class="small muted">${esc(t.overview||"")}</p>`:""}
    <p class="small muted">${esc(t.requirements||"")}</p>
    ${selectable?`<button class="linklike">${t.id===selectedTopic?"Selected":"Choose this topic"}</button>`:""}`;
  if(selectable) card.querySelector("button").onclick = ()=>{ selectedTopic=t.id; selectedCustomTopic=null; renderAll(); };
  return card;
}

async function renderTopics(){
  const box = $("topicList");
  const sub = allSubjects.find(s=>s.id===selectedSubject);
  if(!sub){ box.innerHTML = `<div class="muted small">Select a subject.</div>`; renderUploadInfo(); return; }
  const mode = sub.assignment_mode || "single";
  const topics = await getTopics(sub.id);
  if(sub.id !== selectedSubject) return; // user switched subject while loading

  box.innerHTML = "";
  const badge = document.createElement("div");
  badge.className = "small muted"; badge.style.marginBottom = "8px";
  badge.textContent = mode === "single" ? "Single topic mode" : mode === "multiple" ? "Choose a topic" : "Custom topics allowed";
  box.appendChild(badge);

  if(mode === "single"){
    if(!topics.length){ box.insertAdjacentHTML("beforeend", `<div class="muted small">No topic yet.</div>`); }
    else {
      if(!topics.some(t=>t.id===selectedTopic)) selectedTopic = topics[0].id;
      box.appendChild(topicCard(topics.find(x=>x.id===selectedTopic), {selectable:false}));
    }
  } else if(mode === "multiple"){
    if(!topics.length) box.insertAdjacentHTML("beforeend", `<div class="muted small">No topics yet.</div>`);
    if(selectedTopic && !topics.some(t=>t.id===selectedTopic)) selectedTopic = null;
    topics.forEach(t=>box.appendChild(topicCard(t, {selectable:true})));
  } else {
    if(topics.length){
      const h = document.createElement("h4"); h.textContent = "Teacher topics"; box.appendChild(h);
      topics.forEach(t=>box.appendChild(topicCard(t, {selectable:true, showOverview:false})));
    }
    if(selectedCustomTopic){
      const active = document.createElement("div");
      active.className = "topic sel";
      active.innerHTML = `<h4>Your topic: ${esc(selectedCustomTopic.title)}</h4>
        <p class="spec">Custom topic</p>
        <p class="small muted">${esc(selectedCustomTopic.summary)}</p>
        <button class="linklike">Use teacher topic instead</button>`;
      active.querySelector("button").onclick = ()=>{ selectedCustomTopic=null; selectedTopic=null; renderAll(); };
      box.appendChild(active);
    }
    const form = document.createElement("div");
    form.className = "topic";
    form.innerHTML = `<h4>Create your own topic</h4>
      <input id="customTopicTitle" placeholder="Topic title" maxlength="200">
      <textarea id="customTopicSummary" rows="2" placeholder="Describe your assignment" maxlength="5000"></textarea>
      <div class="toolbar"><button class="btn primary" id="createCustomTopicBtn">Create topic</button></div>`;
    box.appendChild(form);
    $("createCustomTopicBtn").onclick = async ()=>{
      const title = $("customTopicTitle").value.trim();
      const summary = $("customTopicSummary").value.trim();
      if(!title || !summary){ $("uploadMsg").innerHTML = `<div class="alert bad">Title and summary required.</div>`; return; }
      const res = await api("/custom_topics", { method:"POST", body: JSON.stringify({ subject_id: selectedSubject, title, summary }) });
      if(res && res.ok){
        selectedCustomTopic = { id: res.id, title, summary };
        selectedTopic = null;
        renderAll();
      } else {
        $("uploadMsg").innerHTML = `<div class="alert bad">${esc((res && res.error) || "Failed to create custom topic.")}</div>`;
      }
    };
  }
  renderUploadInfo();
}

function currentTarget(){
  const sub = allSubjects.find(s=>s.id===selectedSubject);
  const mode = sub ? sub.assignment_mode || "single" : "single";
  if(mode === "custom" && selectedCustomTopic) return { id: selectedCustomTopic.id, type: "custom", label: `Custom topic: <b>${esc(selectedCustomTopic.title)}</b>` };
  if(selectedTopic){
    const t = (topicCache[selectedSubject]||[]).find(x=>x.id===selectedTopic);
    return { id: selectedTopic, type: "teacher", label: `Topic: <b>${esc(t ? t.title : "selected")}</b>` };
  }
  return { id: null, label: mode === "single" ? "No topic available yet." : "Pick a topic." };
}

function renderUploadInfo(){
  const t = currentTarget();
  $("uploadTopicInfo").innerHTML = t.label;
  $("uploadBtn").disabled = uploading || !t.id || !stagedFiles.length;
}

function stageFiles(fileList){
  $("uploadMsg").innerHTML = "";
  [...fileList].forEach(f=>{
    const ext = f.name.includes(".") ? f.name.split(".").pop().toLowerCase() : "";
    if(!ALLOWED_EXT.includes(ext)){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: .${esc(ext)} not allowed.</div>`; return; }
    if(f.size/1024/1024 > MAX_MB){ $("uploadMsg").innerHTML += `<div class="alert bad">Rejected ${esc(f.name)}: exceeds ${MAX_MB}MB limit.</div>`; return; }
    stagedFiles.push({ file:f, name:f.name, type:ext, sizeKB:Math.round(f.size/1024) });
  });
  $("fileInput").value = "";
  renderFileList(); renderUploadInfo();
}

function renderFileList(){
  $("fileList").innerHTML = stagedFiles.length
    ? stagedFiles.map((f,i)=>`${i+1}. ${esc(f.name)} (${esc(f.type)}, ${f.sizeKB}KB) <a href="#" data-i="${i}">remove</a>`).join("<br>")
    : "No files staged.";
  $("fileList").querySelectorAll("a").forEach(a=>a.onclick=e=>{ e.preventDefault(); stagedFiles.splice(+a.dataset.i,1); renderFileList(); renderUploadInfo(); });
}

async function doUpload(){
  const target = currentTarget();
  if(!target.id || !stagedFiles.length || uploading) return;
  if(!window.blobUpload){ $("uploadMsg").innerHTML = `<div class="alert bad">Uploader is still loading, try again in a moment.</div>`; return; }
  uploading = true; renderUploadInfo();
  $("uploadMsg").innerHTML = `<div class="alert">Uploading…</div>`;
  const folder = `submissions/${encodeURIComponent(me.reg_no)}/`;
  let done = 0;
  try{
    for(const f of [...stagedFiles]){
      let b;
      try{
        b = await window.blobUpload(folder + f.name, f.file, {
          access: "private",
          handleUploadUrl: API_BASE + "/upload",
          headers: { Authorization: "Bearer " + session.token },
          contentType: f.file.type || "application/octet-stream",
        });
      }catch(err){
        $("uploadMsg").innerHTML = `<div class="alert bad">Could not upload ${esc(f.name)}: ${esc((err && err.message) || err)}</div>`;
        return;
      }
      const res = await api("/submissions", {
        method:"POST",
        body: JSON.stringify({ subject_id: selectedSubject, topic_id: target.id, topic_type: target.type,
          file_name: f.name, file_type: f.type, size_kb: f.sizeKB, file_url: b.url })
      });
      if(!res || !res.ok){
        $("uploadMsg").innerHTML = `<div class="alert bad">Could not save ${esc(f.name)}: ${esc((res && res.error) || "unknown error")}</div>`;
        return;
      }
      stagedFiles.splice(stagedFiles.indexOf(f), 1);
      done++;
    }
    $("uploadMsg").innerHTML = `<div class="alert ok">Uploaded ${done} file(s).</div>`;
  } finally {
    uploading = false;
    renderFileList(); renderUploadInfo();
    if(done) refreshSubs();
  }
}

function renderMarksheet(){
  const box = $("marksheet");
  const pub = mySubs.filter(s=>s.published && s.teacher_marks!=null);
  if(!pub.length){ box.innerHTML = `<div class="muted small">No published marks yet.</div>`; return; }
  box.innerHTML = `<table><tr><th>Subject</th><th>Topic</th><th>File</th><th>Marks</th><th>Status</th></tr>` +
    pub.map(s=>`<tr><td>${esc(s.subject_name||"")}</td><td>${esc(s.topic_title||"")}</td><td>${esc(s.file_name)}</td><td><span class="mark">${esc(s.teacher_marks)}</span></td><td><span class="tag pub">published</span>${s.late?' <span class="tag late">late</span>':""}</td></tr>`).join("") +
    `</table>`;
}

function feedbackHTML(fb){
  if(!Array.isArray(fb) || !fb.length) return "";
  return fb.map(f=>{
    const cls = f.type==="wrong"?"feedback-wrong":f.type==="low"?"feedback-low":"feedback-ok";
    return `<div class="${cls}"><b>${f.type==="wrong"?"✘ Needs correction":f.type==="low"?"⚠ Low-confidence":"✔ Good"}</b><div>${esc(f.text)}</div>${f.why?`<div class="small"><b>Why:</b> ${esc(f.why)}</div>`:""}</div>`;
  }).join("");
}

function renderMySubs(){
  const box = $("mySubs"); box.innerHTML = "";
  if(!mySubs.length){ box.innerHTML = `<div class="muted small">Nothing yet.</div>`; return; }
  mySubs.forEach(s=>{
    const d = document.createElement("div");
    d.className = "topic";
    d.innerHTML = `<h4>${esc(s.file_name)}</h4>
      <p class="spec">${esc(s.subject_name||"")}, ${esc(s.topic_title||"")}. Submitted ${esc(fmtTime(s.submitted_at))}.</p>${s.published&&s.teacher_marks!=null?`<p><span class="mark">${esc(s.teacher_marks)}</span></p>`:""}
      <div>${s.published?'<span class="tag pub">published</span>':'<span class="tag unpub">unpublished</span>'}
      ${s.late?'<span class="tag late">late submission</span>':""}
      ${s.file_url?'<button class="linklike" data-dl>Download</button>':""}</div>
      <div style="margin-top:8px">${feedbackHTML(s.feedback)}</div>`;
    const dl = d.querySelector("[data-dl]");
    if(dl) dl.onclick = ()=>downloadSubmission(s);
    box.appendChild(d);
  });
}

function renderAll(){ renderSubjects(); renderTopics(); renderFileList(); renderUploadInfo(); }

$("fileInput").addEventListener("change", e=>stageFiles(e.target.files));
const dz = $("dropZone");
dz.onclick = ()=>$("fileInput").click();
["dragover","dragenter"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("dragover");}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("dragover");}));
dz.addEventListener("drop", e=>stageFiles(e.dataTransfer.files));
$("uploadBtn").onclick = doUpload;
$("logoutBtn").onclick = logout;

init();
