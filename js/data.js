// Shared helpers. Pure front-end, persisted to localStorage only.
// No seed content — subjects, topics and submissions all start empty.
const MAX_MB = 25;
const ALLOWED_EXT = ["pdf","doc","docx","ppt","pptx","txt","odt","rtf"];

const DEFAULT_DB = { subjects: [], topics: [], submissions: [] };

const LS_KEY = "greadter_db_v2";
const OLD_KEYS = ["greadter_db_v1"];
const MINE_KEY = "greadter_mine_v1";
function loadDB(){
  try{
    OLD_KEYS.forEach(k=>localStorage.removeItem(k));
    const raw = localStorage.getItem(LS_KEY);
    if(raw){ const d = JSON.parse(raw); d.subjects=d.subjects||[]; d.topics=d.topics||[]; d.submissions=d.submissions||[]; return d; }
  }catch(e){}
  const clone = JSON.parse(JSON.stringify(DEFAULT_DB));
  try{ localStorage.setItem(LS_KEY, JSON.stringify(clone)); }catch(e){}
  return clone;
}
function saveDB(db){ localStorage.setItem(LS_KEY, JSON.stringify(db)); }
function resetDB(){ localStorage.removeItem(LS_KEY); return loadDB(); }
// ids uploaded from this browser — no fixed identity, no seed profile
function getMine(){ try{ return JSON.parse(localStorage.getItem(MINE_KEY)||"[]"); }catch(e){ return []; } }
function addMine(ids){ try{ const s=new Set(getMine().concat(ids)); localStorage.setItem(MINE_KEY, JSON.stringify([...s])); }catch(e){} }
function clearMine(){ try{ localStorage.removeItem(MINE_KEY); }catch(e){} }
function extOf(name){ const p=name.split("."); return p.length>1?p.pop().toLowerCase():""; }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function isLate(deadline, submittedAt){ if(!deadline) return false; return submittedAt > deadline; }
function downloadCSV(filename, rows){
  const csv = rows.map(r=>r.map(c=>`"${String(c??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv],{type:"text/csv"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function fakeDownload(fileName, meta){
  const blob = new Blob([`Greadter static demo file.\nFile: ${fileName}\n${meta||""}\n(This is a placeholder — real file storage is backend, see remaining_features.txt)`],{type:"text/plain"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = fileName + ".demo.txt"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
