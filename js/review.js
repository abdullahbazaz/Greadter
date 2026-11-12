// Review page: one submission, the AI's check, and the teacher's decision.
// Requires js/auth.js and js/review-render.js.
const session = requirePageRole("teacher");
const subId = new URLSearchParams(location.search).get("id");
let sub = null, review = null, others = [];
const chosen = new Set();   // mistake numbers to include in the student's feedback

// The feedback item a shared mistake becomes. Also used to re-tick mistakes that were shared before.
function mistakeFeedback(m){
  return { type:"wrong", text: m.quote ? `"${m.quote}": ${m.note || ""}` : (m.note || ""), why: m.suggestion || undefined };
}

async function load(){
  const r = await api(`/submissions_admin?id=${encodeURIComponent(subId)}`);
  if(!r) return false;
  if(!r.ok){
    $("who").textContent = "Submission not available";
    $("meta").textContent = r.error || "It may have been deleted, or it belongs to a section you don't teach.";
    return false;
  }
  sub = r.submission; others = r.others || [];
  review = sub.ai_review && typeof sub.ai_review === "object" ? sub.ai_review : null;
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
  const fb = Array.isArray(sub.feedback) ? sub.feedback : [];
  (review && review.mistakes || []).forEach((m, i)=>{ if(fb.some(f=>f.text === mistakeFeedback(m).text)) chosen.add(i + 1); });
  $("comment").value = (fb.find(f=>f.type === "low") || {}).text || "";
  $("marks").value = sub.teacher_marks != null ? sub.teacher_marks : (review && review.suggested_marks != null ? review.suggested_marks : "");
  render();
}

function render(){
  document.title = `${sub.student_name} - Review - Greadter`;
  $("who").textContent = sub.student_name;
  $("meta").textContent = `Roll ${sub.roll_no}, reg. ${sub.reg_no}. ${sub.subject_name || ""}${sub.topic_title ? `: ${sub.topic_title}` : ""}. Submitted ${fmtTime(sub.submitted_at)}.`;
  $("headTags").innerHTML = flagTags(sub);

  const done = review && review.status === "done";
  $("statusBox").innerHTML = done ? "" : renderReviewStatus(review);
  $("dlBtn").hidden = !sub.file_url;

  // The marked sheet
  const hasText = done && typeof review.text === "string" && review.text.length > 0;
  $("sheet").hidden = !hasText; $("layers").hidden = !hasText;
  if(hasText){
    const { html, unplaced } = renderSheet(review);
    $("sheet").innerHTML = html;
    const counts = { m:(review.mistakes || []).length, a:((review.ai_text && review.ai_text.passages) || []).length,
      s:(review.similarity || []).reduce((n, x)=>n + (x.passages || []).length, 0) };
    $("cMistake").textContent = `(${counts.m})`; $("cAi").textContent = `(${counts.a})`; $("cMatch").textContent = `(${counts.s})`;
    $("unplaced").hidden = !unplaced.length;
    $("unplaced").textContent = unplaced.length ? `Mistake ${unplaced.join(", ")} couldn't be matched to the text; see the notes.` : "";
  }

  // The AI's findings
  $("aiMarkBlock").hidden = $("notesBlock").hidden = $("aiTextBlock").hidden = $("simBlock").hidden = !done;
  if(done){
    $("aiMark").innerHTML = renderCriteria(review, sub.total_marks);
    $("notes").innerHTML = renderMistakeNotes(review, chosen);
    $("aiText").innerHTML = renderAiText(review);
    $("sim").innerHTML = renderSimilarity(review, others);
  }
  renderVerdict();
}

function renderVerdict(){
  $("verdict").hidden = false;
  const st = reviewState(sub);
  $("state").innerHTML = `<span class="state-chip state-${st.key}">${esc(st.label)}</span>`;
  $("outOf").textContent = sub.total_marks != null ? `out of ${sub.total_marks}` : "";
  $("marks").max = sub.total_marks != null ? sub.total_marks : "";
  const aiMark = review && review.status === "done" ? review.suggested_marks : null;
  $("useAi").hidden = aiMark == null || String($("marks").value) === String(aiMark);
  $("marksHint").textContent = sub.teacher_marks == null && aiMark != null && String($("marks").value) === String(aiMark)
    ? "Filled in with the AI's suggestion. Change it if you disagree." : "";
  const verified = !!sub.verified_at;
  $("verifyBtn").hidden = verified;
  $("unverifyBtn").hidden = !verified || sub.published;
  $("publishBtn").textContent = sub.published ? "Unpublish" : "Publish to student";
  $("publishBtn").className = sub.published ? "btn" : "btn ok";
  $("publishBtn").disabled = !verified;
  $("publishBtn").title = verified ? "" : "Verify the mark first";
  updateShareCount();
}

function updateShareCount(){
  const n = chosen.size, c = $("comment").value.trim() ? 1 : 0;
  $("shareCount").textContent = n + c
    ? `The student will see ${[c ? "your comment" : "", n ? `${n} ${n === 1 ? "note" : "notes"} on mistakes` : ""].filter(Boolean).join(" and ")}.`
    : "Nothing is selected to send to the student yet, apart from the mark.";
}

function buildFeedback(){
  const items = [];
  const c = $("comment").value.trim();
  if(c) items.push({ type:"low", text:c });
  (review && review.mistakes || []).forEach((m, i)=>{ if(chosen.has(i + 1)) items.push(mistakeFeedback(m)); });
  return items;
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
  unverify:"Verification undone.", publish:"Published. The student can now see their mark and feedback.", unpublish:"Unpublished. The student can no longer see this mark." };

async function decide(action){
  const m = readMarks();
  const msg = $("decisionMsg");
  if(m.error){ msg.innerHTML = `<div class="alert bad">${esc(m.error)}</div>`; $("marks").focus(); return; }
  if((action === "verify") && m.value == null){ msg.innerHTML = `<div class="alert bad">Enter a mark before verifying.</div>`; $("marks").focus(); return; }
  const body = { id: sub.id, teacher_marks: m.value, feedback: buildFeedback() };
  if(action === "verify") body.verify = true;
  if(action === "unverify") body.verify = false;
  if(action === "publish") body.published = true;
  if(action === "unpublish") body.published = false;
  const buttons = ["saveBtn", "verifyBtn", "publishBtn"].map($);
  buttons.forEach(b=>b.disabled = true);
  const r = await api("/submissions_admin", { method:"POST", body: JSON.stringify(body) });
  buttons.forEach(b=>b.disabled = false);
  if(!r) return;
  if(!r.ok){ msg.innerHTML = `<div class="alert bad">${esc(r.error || "That didn't save. Try again.")}</div>`; renderVerdict(); return; }
  await load();
  render();
  msg.innerHTML = `<div class="alert ok">${esc(DONE_MSG[action])}</div>`;
}

// ---- events ----
$("saveBtn").onclick = ()=>decide("save");
$("verifyBtn").onclick = ()=>decide("verify");
$("unverifyBtn").onclick = ()=>decide("unverify");
$("publishBtn").onclick = ()=>decide(sub && sub.published ? "unpublish" : "publish");
$("useAi").onclick = ()=>{ if(review) $("marks").value = review.suggested_marks; renderVerdict(); };
$("comment").addEventListener("input", updateShareCount);
$("marks").addEventListener("input", ()=>{ if(sub) renderVerdict(); });
$("dlBtn").onclick = ()=>downloadSubmission(sub);
$("notes").addEventListener("change", e=>{
  const n = +e.target.dataset.share; if(!n) return;
  e.target.checked ? chosen.add(n) : chosen.delete(n);
  updateShareCount();
});
[["lyMistake","hide-mistake"],["lyAi","hide-aitext"],["lyMatch","hide-match"]].forEach(([box, cls])=>{
  $(box).addEventListener("change", e=>$("sheet").classList.toggle(cls, !e.target.checked));
});
// Clicking an underlined mistake jumps to its note.
$("sheet").addEventListener("click", e=>{
  const hl = e.target.closest(".hl-mistake"); if(!hl) return;
  const n = (hl.dataset.m || "").split(" ")[0];
  const note = n && document.getElementById(`m-note-${n}`);
  if(note){ note.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block:"center" }); note.classList.add("flash"); setTimeout(()=>note.classList.remove("flash"), 1200); }
});

init();
