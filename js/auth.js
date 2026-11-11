// Shared front-end helpers: session, API calls, login/signup, logout, downloads.
// Loaded by every page; page scripts must not redeclare these names.
const API_BASE = "/api";
const SESSION_KEY = "greadter_session_v1";
const LOGIN_PAGE = { student: "student-login.html", teacher: "teacher-login.html", admin: "admin-login.html" };
const HOME_PAGE = { student: "student.html", teacher: "teacher.html", admin: "admin.html" };

const $ = id => document.getElementById(id);
function esc(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function setSession(s){ try{ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }catch(e){} }
function getSession(){ try{ return JSON.parse(localStorage.getItem(SESSION_KEY)||"null"); }catch(e){ return null; } }
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }

function authHeaders(extra){
  const s = getSession();
  const h = { "Content-Type": "application/json", ...(extra||{}) };
  if(s && s.token) h.Authorization = "Bearer " + s.token;
  return h;
}

async function readJSON(res){
  try{ return await res.json(); }catch(e){ return { ok:false, error: `Server error (${res.status})` }; }
}

// Authenticated API call. On 401 the session is dropped and the user is sent to their login page.
async function api(path, opts = {}){
  let res;
  try{ res = await fetch(API_BASE + path, { ...opts, headers: authHeaders(opts.headers) }); }
  catch(e){ return { ok:false, error:"Network error" }; }
  if(res.status === 401){
    const s = getSession(); clearSession();
    location.href = LOGIN_PAGE[s && s.userType] || "index.html";
    return null;
  }
  return readJSON(res);
}

// Call at the top of a dashboard page. Redirects away if not logged in with the right role.
function requirePageRole(role){
  const s = getSession();
  if(!s || !s.token){ location.replace(LOGIN_PAGE[role]); return null; }
  if(s.userType !== role){ location.replace(HOME_PAGE[s.userType] || LOGIN_PAGE[role]); return null; }
  return s;
}

async function logout(){
  const s = getSession();
  try{ await fetch(API_BASE + "/logout", { method:"POST", headers: authHeaders() }); }catch(e){}
  clearSession();
  location.href = LOGIN_PAGE[s && s.userType] || "index.html";
}

// Download an authenticated endpoint as a file (a plain link cannot send the token).
async function downloadAuthed(path, filename){
  const res = await fetch(API_BASE + path, { headers: authHeaders() });
  if(!res.ok){ const d = await readJSON(res); alert(d.error || "Download failed"); return false; }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
  return true;
}

// Neon returns TIMESTAMP/DATE columns as ISO strings ("2026-11-11T09:30:00.000Z").
const fmtDate = d => d ? String(d).slice(0, 10) : "";
const fmtTime = d => d ? String(d).slice(0, 16).replace("T", " ") : "";
const downloadSubmission = s => downloadAuthed(`/download?id=${encodeURIComponent(s.id)}`, s.file_name || "submission");

async function postJSON(path, body){
  try{
    const res = await fetch(API_BASE + path, { method:"POST", headers: authHeaders(), body: JSON.stringify(body) });
    return readJSON(res);
  }catch(e){ return { ok:false, error:"Network error — is the backend deployed?" }; }
}

// ---- login ----
async function attemptLogin(regOrEmail, password, role){
  const data = await postJSON("/login", { email: regOrEmail.trim(), password, role });
  if(!data.ok) return { ok:false, msg: data.error || "Login failed" };
  setSession({ token: data.token, userId: data.user.id, userType: data.user.role, name: data.user.name });
  return { ok:true, redirect: HOME_PAGE[data.user.role] || "index.html" };
}
const loginAdmin = (email, password) => attemptLogin(email, password, "admin");

// ---- signup ----
async function doSignup(body, fallbackMsg){
  const data = await postJSON("/signup", body);
  return data.ok ? { ok:true, msg: data.msg || fallbackMsg } : { ok:false, msg: data.error || "Signup failed" };
}
const signupStudent = ({name, roll, reg, dept, email, pass, section, year}) =>
  doSignup({ name, roll, reg, dept, email, pass, role:"student", section, year }, "Account created.");
const signupTeacher = ({name, dept, email, pass}) =>
  doSignup({ name, dept, email, pass, role:"teacher" }, "Account created as pending.");
// After the first admin exists, the server only accepts this from a logged-in admin (token sent automatically).
const signupAdmin = ({name, email, pass}) =>
  doSignup({ name, email, pass, role:"admin" }, "Admin account created.");
