// Review page: one submission's PDF with its issues, the AI check, and the teacher's decision.
// Requires js/auth.js, js/review-render.js, js/pdf-mark.js and pdf.js.
const session = requirePageRole("teacher");
const subId = new URLSearchParams(location.search).get("id");
let sub = null, review = null, others = [], issues = [], marker = null, pdfData = null;
let saveChain = Promise.resolve();

const locked = () => !!(sub && sub.published);
const commentOf = fb => ((Array.isArray(fb) ? fb : []).find(f=>f.type === "low") || {}).text || "";
const aiPassages = () => (review && review.ai_text && review.ai_text.passages || []).map(p=>({ page:p.page, quote:p.quote }));

// Issues numbered in reading order: by page, then top to bottom.
function sortIssues(list){
  return [...list].sort((a, b)=>a.page - b.page
    || ((a.rects && a.rects[0] ? a.rects[0][1] : 2) - (b.rects && b.rects[0] ? b.rects[0][1] : 2))
    || ((a.rects && a.rects[0] ? a.rects[0][0] : 0) - (b.rects && b.rects[0] ? b.rects[0][0] : 0)));
}

async function load(){
  const r = await api(`/submissions_admin?id=${encodeURIComponent(subId)}`);
  if(!r) return false;
  if(!r.ok){
    $("who").textContent = "Submission not available";
    $("meta").textContent = r.error || "It may have been deleted, or it belongs to a class you don't teach.";
    return false;
  }
  sub = r.submission; others = r.others || [];
  review = sub.ai_review && typeof sub.ai_review === "object" ? sub.ai_review : null;
  issues = sortIssues(Array.isArray(sub.annotations) ? sub.annotations : []);
  return true;
}

async function init(){
  if(!session) return;
  if(!subId){
    $("who").textContent = "No submission chosen";
    $("meta").innerHTML = `Pick one from <a class="link" href="teacher.html#check">your submissions</a>.`;
    return;
  }
  const [ok, me] = await Promise.all([load(), api("/me")]);
  if(me && me.ok) setFlagThresholds(me.user.flag_settings);
  if(!ok) return;
  $("comment").value = commentOf(sub.feedback);
  $("marks").value = sub.teacher_marks != null ? sub.teacher_marks : (review && review.status === "done" && review.suggested_marks != null ? review.suggested_marks : "");
  render();
  await loadPdf();
}

async function loadPdf(){
  if(!isPdf(sub) || !sub.file_url) return;
  marker = createPdfMarker($("pdf"), {
    editable: !locked(), onAdd: addIssue, onDelete: deleteIssue, onChange: renderIssueList,
    onRegionMode: on=>{
      $("drawBtn").setAttribute("aria-pressed", String(on));
      $("drawBtn").textContent = on ? "Drag a box on the page (Esc to cancel)" : "Mark a diagram";
    },
  });
  try{
    const res = await fetch(`${API_BASE}/download?id=${encodeURIComponent(sub.id)}`, { headers: authHeaders() });
    if(!res.ok) throw new Error("The PDF couldn't be downloaded.");
    pdfData = await res.arrayBuffer();
    await marker.load(pdfData.slice(0));   // pdf.js takes ownership of the buffer it's given; keep a copy
    marker.setIssues(issues);
    marker.setHighlights(aiPassages());
    placeAiIssues();
  }catch(e){
    $("pdf").innerHTML = `<div class="alert bad">${esc(e.message || "The PDF couldn't be shown.")} Download the original file to read it.</div>`;
  }
}

// AI issues arrive with a quote and a page; find them on the page once, then save their positions.
function placeAiIssues(){
  if(!marker || !marker.loaded) return;
  const placed = marker.resolve();
  issues = sortIssues(marker.getIssues());
  marker.setIssues(issues);
  if(placed && !locked()) saveIssues();
}

function saveIssues(msg){
  saveChain = saveChain.then(async ()=>{
    const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify({ id: sub.id, annotations: issues }) });
    if(!r) return;
    $("decisionMsg").innerHTML = r.ok ? (msg ? `<div class="alert ok">${esc(msg)}</div>` : "") : `<div class="alert bad">${esc(r.error || "Couldn't save the issues. Try again.")}</div>`;
  });
  return saveChain;
}
function addIssue(issue){
  issues = sortIssues([...issues, issue]);
  marker.setIssues(issues);
  saveIssues("Issue added. The student will see it once you publish.");
}
function deleteIssue(a){
  issues = issues.filter(x=>x.id !== a.id);
  marker.setIssues(issues);
  saveIssues("Issue deleted.");
}

const LABEL = { spelling:"Spelling", grammar:"Grammar", fact:"Fact", logic:"Reasoning", requirement:"Missed requirement", diagram:"Diagram", other:"Note" };
function renderIssueList(list){
  list = list || issues;
  $("issueCount").textContent = list.length ? String(list.length) : "";
  const box = $("issueList");
  if(!list.length){
    box.innerHTML = `<li class="small muted">${review && review.status === "done" ? "No issues. Add one by selecting text on the page." : "No issues yet. Run the AI check, or select text on the page to add one."}</li>`;
    return;
  }
  box.innerHTML = list.map((a, i)=>{
    const onPage = a.rects && a.rects.length;
    return `<li class="note-item">
      <span class="note-n" aria-hidden="true">${i + 1}</span>
      <div>
        <p class="note-kind">${esc(LABEL[a.category] || "Note")} <span class="small muted">page ${esc(a.page)}${a.location ? `, ${esc(a.location)}` : ""}. ${a.source === "ai" ? "Found by the AI" : "Added by you"}</span></p>
        <p>${esc(a.note || "")}</p>
        ${onPage ? (a.approx ? `<p class="small muted">The exact words weren't found on the page, so the dashed box is the AI's estimate.</p>` : "")
                 : `<p class="small muted">Not found on the page, so it's pinned to the top corner of page ${esc(a.page)}.${a.quote ? ` It refers to: <q>${esc(a.quote)}</q>` : ""}</p>`}
        <div class="toolbar">
          <button class="linklike" type="button" data-show="${esc(a.id)}">Show on page</button>
          ${locked() ? "" : `<button class="linklike" type="button" data-del="${esc(a.id)}">Delete</button>`}
        </div>
      </div>
    </li>`;
  }).join("");
}
$("issueList").addEventListener("click", e=>{
  const show = e.target.closest("[data-show]"), del = e.target.closest("[data-del]");
  if(show && marker) marker.openIssue(show.dataset.show);
  if(del){ const a = issues.find(x=>x.id === del.dataset.del); if(a) deleteIssue(a); }
});

function render(){
  document.title = `${sub.student_name} - Review - Greadter`;
  $("who").textContent = sub.student_name;
  $("meta").textContent = `Roll ${sub.roll_no}, reg. ${sub.reg_no}. ${sub.subject_name || ""}${sub.topic_title ? `: ${sub.topic_title}` : ""}. Submitted ${fmtTime(sub.submitted_at)}.`;
  $("headTags").innerHTML = flagTags(sub);

  const st = reviewState(sub), done = review && review.status === "done";
  $("aiBar").hidden = !isPdf(sub) || locked();
  $("runAi").disabled = st.key === "checking";
  $("runAi").textContent = st.key === "checking" ? "AI is checking…" : done ? "Run AI check again" : "Run AI check";
  if(done && !$("aiState").dataset.busy) $("aiState").textContent = `Checked ${fmtTime(review.checked_at)}.`;
  $("statusBox").innerHTML = done ? "" : renderReviewStatus(sub);
  $("dlBtn").hidden = !sub.file_url;

  $("viewerTools").hidden = !isPdf(sub);
  $("drawBtn").hidden = locked();
  $("editHint").textContent = locked() ? "Published: the mark and issues are final." : "Select text on the page to mark it as an issue. To mark a diagram, press \"Mark a diagram\" and drag a box around it.";
  $("issueHelp").textContent = locked() ? "These are the issues the student received." : "Issues show in red on the page. Click one to read it. Students see the issues you keep once you publish.";

  $("aiMarkBlock").hidden = $("aiTextBlock").hidden = $("simBlock").hidden = !done;
  if(done){
    $("aiMark").innerHTML = renderCriteria(review, sub.total_marks);
    $("aiText").innerHTML = renderAiText(review);
    $("sim").innerHTML = renderSimilarity(review, others);
  }
  renderIssueList();
  renderVerdict();
}

function renderVerdict(){
  $("verdict").hidden = false;
  const st = reviewState(sub);
  $("state").innerHTML = `<span class="state-chip state-${st.key}">${esc(st.label)}</span>`;
  $("outOf").textContent = sub.total_marks != null ? `out of ${sub.total_marks}` : "";
  $("marks").max = sub.total_marks != null ? sub.total_marks : "";
  const aiMark = review && review.status === "done" ? review.suggested_marks : null;
  $("marks").disabled = $("comment").disabled = locked();
  $("useAi").hidden = locked() || aiMark == null || String($("marks").value) === String(aiMark);
  $("marksHint").textContent = !locked() && sub.teacher_marks == null && aiMark != null && String($("marks").value) === String(aiMark)
    ? "Filled in with the AI's suggestion. Change it if you disagree." : "";
  const verified = !!sub.verified_at;
  $("decideBtns").hidden = locked();
  $("verifyBtn").hidden = verified;
  $("unverifyBtn").hidden = !verified || locked();
  $("publishBtn").disabled = !verified;
  $("publishBtn").title = verified ? "" : "Verify the mark first";
  $("finalNote").textContent = locked()
    ? "Published. This mark is final: the student has their mark, your comment and the marked PDF."
    : "Publishing sends the student their mark, your comment and the marked PDF. Published marks are final and can't be changed.";
}

function readMarks(){
  const v = $("marks").value.trim();
  if(v === "") return { value:null };
  const n = Number(v);
  if(!Number.isInteger(n) || n < 0) return { error:"Enter the mark as a whole number." };
  if(sub.total_marks != null && n > sub.total_marks) return { error:`The mark can't be more than ${sub.total_marks}.` };
  return { value:n };
}

const DONE_MSG = { save:"Draft saved.", verify:"Mark verified. Publish it when you're ready for the student to see it.",
  unverify:"Verification undone.", publish:"Published. The student can now see their mark, your comment and the marked PDF." };

async function decide(action){
  const m = readMarks(), msg = $("decisionMsg");
  if(m.error){ msg.innerHTML = `<div class="alert bad">${esc(m.error)}</div>`; $("marks").focus(); return; }
  if(action === "verify" && m.value == null){ msg.innerHTML = `<div class="alert bad">Enter a mark before verifying.</div>`; $("marks").focus(); return; }
  if(action === "publish" && !confirm(`Publish ${m.value} out of ${sub.total_marks ?? "?"} to ${sub.student_name}? They'll see the mark, your comment and the ${issues.length} marked ${issues.length === 1 ? "issue" : "issues"}. Published marks are final and can't be changed.`)) return;
  const c = $("comment").value.trim();
  const body = { id: sub.id, teacher_marks: m.value, feedback: c ? [{ type:"low", text:c }] : [], annotations: issues };
  if(action === "verify") body.verify = true;
  if(action === "unverify") body.verify = false;
  if(action === "publish") body.published = true;
  const buttons = ["saveBtn", "verifyBtn", "publishBtn"].map($);
  buttons.forEach(b=>b.disabled = true);
  await saveChain;
  const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify(body) });
  buttons.forEach(b=>b.disabled = false);
  if(!r) return;
  if(!r.ok){ msg.innerHTML = `<div class="alert bad">${esc(r.error || "That didn't save. Try again.")}</div>`; renderVerdict(); return; }
  await load();
  render();
  if(action === "publish"){ marker = null; await loadPdf(); }   // reload read-only
  msg.innerHTML = `<div class="alert ok">${esc(DONE_MSG[action])}</div>`;
}

// ---- AI check, started by the teacher ----
async function runAiCheck(){
  if(review && review.status === "done" && !confirm("Run the AI check again? It replaces the AI's issues and suggested mark. Issues you added yourself stay.")) return;
  const btn = $("runAi"), state = $("aiState");
  btn.disabled = true; btn.textContent = "AI is checking…"; state.dataset.busy = "1";
  state.textContent = "Reading the PDF…";
  let text = "";
  try{ if(pdfData) text = await extractPdfText(pdfData.slice(0)); }catch(e){ text = ""; }
  const t0 = Date.now();
  const tick = setInterval(()=>{ state.textContent = `The AI is checking the work. This usually takes a minute or two (${Math.round((Date.now() - t0) / 1000)}s).`; }, 1000);
  const r = await api("/ai_check", { method:"POST", body: JSON.stringify({ id: sub.id, text }) });
  clearInterval(tick); delete state.dataset.busy;
  await load();
  render();
  if(!r) return;
  if(!r.ok){ state.innerHTML = `<span class="alert bad">${esc(r.error || "The AI check failed. Try again.")}</span>`; return; }
  state.textContent = `Done. The AI found ${r.issues} ${r.issues === 1 ? "issue" : "issues"}${r.suggested_marks != null ? ` and suggests ${r.suggested_marks}` : ""}. Check them before verifying.`;
  if(sub.teacher_marks == null && review && review.suggested_marks != null) $("marks").value = review.suggested_marks;
  renderVerdict();
  if(marker && marker.loaded){ marker.setIssues(issues); marker.setHighlights(aiPassages()); placeAiIssues(); }
}

// ---- events ----
$("runAi").onclick = runAiCheck;
$("saveBtn").onclick = ()=>decide("save");
$("verifyBtn").onclick = ()=>decide("verify");
$("unverifyBtn").onclick = ()=>decide("unverify");
$("publishBtn").onclick = ()=>decide("publish");
$("useAi").onclick = ()=>{ if(review) $("marks").value = review.suggested_marks; renderVerdict(); };
$("marks").addEventListener("input", ()=>{ if(sub) renderVerdict(); });
$("dlBtn").onclick = ()=>downloadSubmission(sub);
$("drawBtn").onclick = ()=>{ if(marker) marker.setRegionMode($("drawBtn").getAttribute("aria-pressed") !== "true"); };
$("lyIssues").addEventListener("change", e=>marker && marker.showLayer("issues", e.target.checked));
$("lyAi").addEventListener("change", e=>marker && marker.showLayer("ai", e.target.checked));

init();
