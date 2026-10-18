// Auth helpers — calls live Vercel API (Neon backend)
const API_BASE = "https://projectgreadter.vercel.app/api";

const $ = id => document.getElementById(id);

function setSession(s){ try{ localStorage.setItem("greadter_session_v1", JSON.stringify(s)); }catch(e){} }
function getSession(){ try{ return JSON.parse(localStorage.getItem("greadter_session_v1")||"null"); }catch(e){ return null; } }
function clearSession(){ try{ localStorage.removeItem("greadter_session_v1"); }catch(e){} }

// ---- login ----
async function attemptLogin(regOrEmail, password, role){
  try{
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ email: regOrEmail, password, role })
    });
    const data = await res.json();

    if(!data.ok){
      return {ok:false, msg: data.error || "Login failed"};
    }

    setSession({
      token: data.token,
      userId: data.user.id,
      userType: data.user.role,
      name: data.user.name
    });

    return {ok:true, redirect: data.user.role === "student" ? "student.html" : "teacher.html"};
  }catch(e){
    return {ok:false, msg: "Network error — is the backend deployed?"};
  }
}

// ---- signup ----
async function signupStudent({name, roll, reg, dept, email, pass}){
  try{
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, roll, reg, dept, email, pass, role: "student" })
    });
    const data = await res.json();

    if(!data.ok){
      return {ok:false, msg: data.error || "Signup failed"};
    }

    return {ok:true, msg: data.msg || "Account created."};
  }catch(e){
    return {ok:false, msg: "Network error — is the backend deployed?"};
  }
}

async function signupTeacher({name, dept, email, pass}){
  try{
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name, dept, email, pass, role: "teacher" })
    });
    const data = await res.json();

    if(!data.ok){
      return {ok:false, msg: data.error || "Signup failed"};
    }

    return {ok:true, msg: data.msg || "Account created as pending."};
  }catch(e){
    return {ok:false, msg: "Network error — is the backend deployed?"};
  }
}

// expose to window for inline handlers
window.attemptLogin = attemptLogin;
window.signupStudent = signupStudent;
window.signupTeacher = signupTeacher;
