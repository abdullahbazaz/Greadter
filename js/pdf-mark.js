// PDF viewer with red issue marks, used by the teacher's review page and the student's results.
// Requires pdf.js 3.x (window.pdfjsLib, loaded from cdnjs) and js/auth.js (esc).
//
// Positions are stored as fractions of the page (0–1, top-left origin), so marks land in the
// same place at any zoom and in the server-built marked PDF.
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const ISSUE_LABEL = { spelling:"Spelling", grammar:"Grammar", fact:"Fact", logic:"Reasoning", requirement:"Missed requirement", diagram:"Diagram", other:"Note" };

function pdfReady(){
  if(!window.pdfjsLib) throw new Error("The PDF viewer didn't load. Check your connection and reload the page.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjsLib;
}

// Plain text of a PDF, page by page (used for the similarity check).
async function extractPdfText(data){
  const pdf = await pdfReady().getDocument({ data }).promise;
  const pages = [];
  for(let n = 1; n <= pdf.numPages; n++){
    const tc = await (await pdf.getPage(n)).getTextContent();
    pages.push(tc.items.map(i=>i.str).join(" "));
  }
  return pages.join("\n");
}

// Letters and digits only, lower-cased, with a map back to each character's place in the text layer.
function normalisedIndex(spans){
  let norm = ""; const map = [];
  spans.forEach(span=>{
    const node = span.firstChild;
    if(!node || node.nodeType !== 3) return;
    const t = node.textContent;
    for(let i = 0; i < t.length; i++){
      const c = t[i].toLowerCase();
      if(/[\p{L}\p{N}]/u.test(c)){ norm += c; map.push([node, i]); }
    }
  });
  return { norm, map };
}
const normalise = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function createPdfMarker(root, opts = {}){
  const editable = !!opts.editable;
  let pages = [], issues = [], highlights = [], regionMode = false, openPop = null, pendingSel = null;

  root.classList.add("pdfm");
  root.innerHTML = `<p class="small muted pdfm-loading">Loading the PDF…</p>`;

  function rectOf(el, pageEl){
    const p = pageEl.getBoundingClientRect(), r = el;
    return [(r.left - p.left) / p.width, (r.top - p.top) / p.height, r.width / p.width, r.height / p.height];
  }
  // Merge the many small rectangles a text selection produces into one per line.
  function mergeLines(rects){
    const lines = [];
    rects.filter(r=>r[2] > 0.001 && r[3] > 0.001).sort((a, b)=>a[1] - b[1] || a[0] - b[0]).forEach(r=>{
      const L = lines.find(l=>Math.abs(l[1] - r[1]) < r[3] * 0.5 && Math.abs(l[3] - r[3]) < r[3] * 0.6);
      if(L){ const x2 = Math.max(L[0] + L[2], r[0] + r[2]); L[0] = Math.min(L[0], r[0]); L[2] = x2 - L[0]; }
      else lines.push([...r]);
    });
    return lines.slice(0, 40);
  }

  async function load(data){
    const pdf = await pdfReady().getDocument({ data }).promise;
    root.innerHTML = "";
    pages = [];
    const width = Math.max(320, root.clientWidth || 760);
    for(let n = 1; n <= pdf.numPages; n++){
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, width / base.width);
      const vp = page.getViewport({ scale });
      const el = document.createElement("div");
      el.className = "pdfm-page"; el.dataset.page = n;
      el.style.width = `${vp.width}px`; el.style.height = `${vp.height}px`;
      el.setAttribute("aria-label", `Page ${n}`);
      const canvas = document.createElement("canvas");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`; canvas.style.height = `${vp.height}px`;
      const text = document.createElement("div"); text.className = "textLayer";
      text.style.setProperty("--scale-factor", scale);
      const marks = document.createElement("div"); marks.className = "pdfm-marks";
      el.append(canvas, text, marks);
      const num = document.createElement("p"); num.className = "pdfm-pageno small muted"; num.textContent = `Page ${n} of ${pdf.numPages}`;
      root.append(el, num);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
      const tc = await page.getTextContent();
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: text, viewport: vp, textDivs: [] }).promise;
      pages.push({ n, el, text, marks });
      if(editable) wireEditing(pages[pages.length - 1]);
    }
    draw();
  }

  // Find an issue's quote on its page and return line rectangles, or [] if it can't be found.
  function findQuote(pageNo, quote){
    const p = pages.find(x=>x.n === pageNo); const q = normalise(quote);
    if(!p || q.length < 3) return [];
    const spans = [...p.text.querySelectorAll("span")].filter(s=>!s.children.length);
    const { norm, map } = normalisedIndex(spans);
    const at = norm.indexOf(q);
    if(at < 0) return [];
    const [sn, so] = map[at], [en, eo] = map[at + q.length - 1];
    const range = document.createRange();
    range.setStart(sn, so); range.setEnd(en, eo + 1);
    return mergeLines([...range.getClientRects()].map(r=>rectOf(r, p.el)));
  }

  // Place issues that have no position yet (e.g. fresh from the AI): by their exact words first,
  // then by the AI's approximate box (scanned pages). Issues with neither get a pin at the top of
  // their page when drawn. Returns how many were placed.
  function resolve(){
    let placed = 0;
    issues.forEach(a=>{
      if(a.rects && a.rects.length) return;
      const r = a.kind === "text" && a.quote ? findQuote(a.page, a.quote) : [];
      if(r.length){ a.rects = r; placed++; }
      else if(a.fallback){ a.rects = [a.fallback]; a.approx = true; placed++; }
    });
    highlights.forEach(h=>{ if(!h.rects) h.rects = findQuote(h.page, h.quote); });
    if(placed) draw();
    return placed;
  }

  function draw(){
    closePop();
    pages.forEach(p=>{ p.marks.innerHTML = ""; });
    highlights.forEach(h=>(h.rects || []).forEach(r=>{
      const p = pages.find(x=>x.n === h.page); if(!p) return;
      const d = document.createElement("div"); d.className = "pdfm-hl"; place(d, r); p.marks.appendChild(d);
    }));
    const pins = {};
    issues.forEach((a, i)=>{
      const p = pages.find(x=>x.n === a.page);
      if(!p) return;
      // No position on the page: a numbered pin in the page's top corner, so it's still on its page.
      if(!a.rects || !a.rects.length){
        if(!pins[p.n]){ pins[p.n] = document.createElement("div"); pins[p.n].className = "pdfm-pins"; p.marks.appendChild(pins[p.n]); }
        const b = document.createElement("button");
        b.type = "button"; b.className = "pdfm-num"; b.textContent = i + 1; b.dataset.id = a.id;
        b.setAttribute("aria-label", `Issue ${i + 1} on this page${a.location ? `, ${a.location}` : ""}. Show explanation`);
        b.addEventListener("click", e=>{ e.stopPropagation(); openIssue(a.id); });
        pins[p.n].appendChild(b);
        return;
      }
      a.rects.forEach((r, j)=>{
        const m = document.createElement("div");
        m.className = `pdfm-mark pdfm-${a.kind}${a.approx ? " pdfm-approx" : ""}`; m.dataset.id = a.id; place(m, r);
        m.addEventListener("click", e=>{ e.stopPropagation(); openIssue(a.id); });
        p.marks.appendChild(m);
        if(j === 0){
          const b = document.createElement("button");
          b.type = "button"; b.className = "pdfm-num"; b.textContent = i + 1; b.dataset.id = a.id;
          b.setAttribute("aria-label", `Issue ${i + 1}: ${ISSUE_LABEL[a.category] || "Note"}. Show explanation`);
          b.style.left = `${r[0] * 100}%`; b.style.top = `${r[1] * 100}%`;
          b.addEventListener("click", e=>{ e.stopPropagation(); openIssue(a.id); });
          p.marks.appendChild(b);
        }
      });
    });
    if(opts.onChange) opts.onChange(issues);
  }
  function place(el, [x, y, w, h]){ Object.assign(el.style, { left:`${x * 100}%`, top:`${y * 100}%`, width:`${w * 100}%`, height:`${h * 100}%` }); }

  // ---- the dropdown with the explanation ----
  function closePop(){
    if(openPop){ const back = openPop.returnFocus; openPop.el.remove(); openPop = null; if(back && document.contains(back)) back.focus(); }
    root.querySelectorAll(".pdfm-mark.on").forEach(m=>m.classList.remove("on"));
  }
  function popAt(p, r, html, returnFocus){
    closePop();
    const pop = document.createElement("div");
    pop.className = "pdfm-pop"; pop.setAttribute("role", "dialog");
    pop.innerHTML = `<button type="button" class="pdfm-close" aria-label="Close">×</button>${html}`;
    pop.style.top = `calc(${(r[1] + r[3]) * 100}% + 8px)`;
    pop.style.left = `${Math.min(r[0], 0.55) * 100}%`;
    p.el.appendChild(pop);
    pop.querySelector(".pdfm-close").onclick = closePop;
    openPop = { el: pop, returnFocus, t: performance.now() };
    const first = pop.querySelector("textarea, select, button:not(.pdfm-close)") || pop.querySelector(".pdfm-close");
    first.focus({ preventScroll: true });
    pop.scrollIntoView({ block:"nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return pop;
  }
  function openIssue(id){
    const i = issues.findIndex(a=>a.id === id); if(i < 0) return;
    const a = issues[i], p = pages.find(x=>x.n === a.page);
    if(!p) return;
    root.querySelectorAll(`.pdfm-mark[data-id="${CSS.escape(id)}"]`).forEach(m=>m.classList.add("on"));
    const placed = a.rects && a.rects.length;
    const pop = popAt(p, placed ? a.rects[a.rects.length - 1] : [0.45, 0.01, 0.5, 0.04], `
      <p class="pdfm-pop-title"><span class="pdfm-pop-n">${i + 1}</span> ${esc(ISSUE_LABEL[a.category] || "Note")}${editable && a.source ? `<span class="small muted">, found by ${a.source === "ai" ? "the AI" : "you"}</span>` : ""}</p>
      ${a.location ? `<p class="small"><b>Where:</b> ${esc(a.location)}${a.approx ? " (the red box is approximate)" : ""}</p>` : ""}
      ${a.quote && a.kind === "text" ? `<p class="small muted"><q>${esc(a.quote)}</q></p>` : ""}
      <p>${esc(a.note || "")}</p>
      ${a.suggestion ? `<p class="small">Suggestion: ${esc(a.suggestion)}</p>` : ""}
      ${editable ? `<div class="toolbar"><button type="button" class="btn small danger" data-del>Delete this issue</button></div>` : ""}`,
      root.querySelector(`.pdfm-num[data-id="${CSS.escape(id)}"]`));
    const del = pop.querySelector("[data-del]");
    if(del) del.onclick = ()=>{ closePop(); if(opts.onDelete) opts.onDelete(a); };
  }

  // ---- teachers add issues: select text, or draw a box around a diagram ----
  function issueForm(p, r, kind, quote){
    const pop = popAt(p, r, `
      <p class="pdfm-pop-title">New issue${kind === "region" ? " on this area" : ""}</p>
      ${quote ? `<p class="small muted"><q>${esc(quote.slice(0, 200))}</q></p>` : ""}
      <label>Type<select data-f="category">${Object.entries(ISSUE_LABEL).map(([k, v])=>`<option value="${k}" ${k === (kind === "region" ? "diagram" : "fact") ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>What's wrong <span class="muted">(the student sees this)</span><textarea data-f="note" rows="3" maxlength="2000"></textarea></label>
      <label>How to fix it <span class="muted">(optional)</span><textarea data-f="suggestion" rows="2" maxlength="1000"></textarea></label>
      <div class="toolbar"><button type="button" class="btn small primary" data-save>Add issue</button><button type="button" class="linklike" data-cancel>Cancel</button></div>
      <p class="small pdfm-err" role="alert"></p>`);
    pop.querySelector("[data-cancel]").onclick = closePop;
    pop.querySelector("[data-save]").onclick = ()=>{
      const note = pop.querySelector('[data-f="note"]').value.trim();
      if(!note){ pop.querySelector(".pdfm-err").textContent = "Write what's wrong so the student understands the mark."; return; }
      const issue = { id:`t${Date.now().toString(36)}`, page:p.n, kind, category:pop.querySelector('[data-f="category"]').value,
        quote: (quote || "").slice(0, 500), note, suggestion: pop.querySelector('[data-f="suggestion"]').value.trim(),
        rects: kind === "region" ? [r] : pendingSel.rects, source:"teacher" };
      closePop(); window.getSelection().removeAllRanges(); hideAddButton();
      if(opts.onAdd) opts.onAdd(issue);
    };
  }

  let addBtn = null;
  function hideAddButton(){ if(addBtn){ addBtn.remove(); addBtn = null; } }
  function wireEditing(p){
    p.text.addEventListener("mouseup", ()=>setTimeout(()=>{
      const sel = window.getSelection();
      if(!sel || sel.isCollapsed || !sel.rangeCount || regionMode) return;
      const range = sel.getRangeAt(0);
      if(!p.text.contains(range.commonAncestorContainer)) return;
      const rects = mergeLines([...range.getClientRects()].map(r=>rectOf(r, p.el)));
      const quote = sel.toString().replace(/\s+/g, " ").trim();
      if(!rects.length || quote.length < 2) return;
      pendingSel = { p, rects, quote };
      hideAddButton();
      addBtn = document.createElement("button");
      addBtn.type = "button"; addBtn.className = "btn small primary pdfm-add"; addBtn.textContent = "Mark as an issue";
      const last = rects[rects.length - 1];
      addBtn.style.left = `${Math.min(last[0] + last[2], 0.8) * 100}%`; addBtn.style.top = `calc(${(last[1] + last[3]) * 100}% + 4px)`;
      addBtn.onmousedown = e=>e.preventDefault();   // keep the selection
      addBtn.onclick = e=>{ e.stopPropagation(); hideAddButton(); issueForm(p, last, "text", quote); };
      p.el.appendChild(addBtn);
    }, 0));

    // Region drawing (diagrams, figures, tables)
    let start = null, ghost = null;
    p.marks.addEventListener("pointerdown", e=>{
      if(!regionMode || e.button !== 0) return;
      e.preventDefault();
      const b = p.el.getBoundingClientRect();
      start = [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
      ghost = document.createElement("div"); ghost.className = "pdfm-mark pdfm-region pdfm-ghost"; p.marks.appendChild(ghost);
      p.marks.setPointerCapture(e.pointerId);
    });
    p.marks.addEventListener("pointermove", e=>{
      if(!start || !ghost) return;
      const b = p.el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
      place(ghost, [Math.min(start[0], x), Math.min(start[1], y), Math.abs(x - start[0]), Math.abs(y - start[1])]);
    });
    p.marks.addEventListener("pointerup", e=>{
      if(!start || !ghost) return;
      const b = p.el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y = Math.min(1, Math.max(0, (e.clientY - b.top) / b.height));
      const r = [Math.min(start[0], x), Math.min(start[1], y), Math.abs(x - start[0]), Math.abs(y - start[1])];
      start = null;
      if(r[2] < 0.02 || r[3] < 0.01){ ghost.remove(); ghost = null; return; }
      setRegionMode(false);
      issueForm(p, r, "region", "");
      ghost.remove(); ghost = null;
    });
  }
  function setRegionMode(on){
    regionMode = !!on;
    root.classList.toggle("pdfm-drawing", regionMode);
    if(opts.onRegionMode) opts.onRegionMode(regionMode);
  }

  document.addEventListener("keydown", e=>{
    if(e.key !== "Escape") return;
    if(openPop) closePop(); else if(regionMode) setRegionMode(false);
    hideAddButton();
  });
  // Click outside closes the dropdown (ignoring the click that just opened it, e.g. finishing a drawn box).
  root.addEventListener("click", e=>{ if(openPop && performance.now() - openPop.t > 300 && !openPop.el.contains(e.target)) closePop(); });

  return {
    load, resolve, openIssue, setRegionMode,
    setIssues(list){ issues = (list || []).map(a=>({ ...a, rects: (a.rects || []).map(r=>[...r]) })); draw(); },
    setHighlights(list){ highlights = (list || []).map(h=>({ ...h })); draw(); },
    showLayer(name, on){ root.classList.toggle(`pdfm-hide-${name}`, !on); },
    getIssues(){ return issues.map(a=>({ ...a })); },
    get loaded(){ return pages.length > 0; },
  };
}
