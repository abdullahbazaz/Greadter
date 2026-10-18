// Auth helpers shared by login.html and signup.html.
// Mock backend — replace with /api/* calls to Neon later.

const $ = id => document.getElementById(id);

function currentDB(){ return loadDB(); }
function saveCurrentDB(db){ saveDB(db); }

// ---- login ----
function attemptLogin(regOrEmail, password, role){
  const db = currentDB();
  if(role === "student"){
    const u = db.students.find(s => s.reg_no === regOrEmail || s.email === regOrEmail);
    if(!u) return {ok:false, msg:"Registration no. not found."};
    if(u.status === "inactive") return {ok:false, msg:"Account is inactive."};
    if(!u.emailVerified) return {ok:false, msg:"Please verify your email before logging in."};
    // mock: accept any password for demo
    setSession({token: uid("sess_"), userId: u.reg_no, userType:"student", name: u.name, regNo: u.reg_no});
    return {ok:true, redirect:"student.html"};
  } else {
    const u = db.teachers.find(t => t.email === regOrEmail);
    if(!u) return {ok:false, msg:"University email not found."};
    if(u.status === "pending") return {ok:false, msg:"Your account is awaiting admin approval."};
    if(u.status === "inactive") return {ok:false, msg:"Account is inactive."};
    setSession({token: uid("sess_"), userId: u.id, userType:"teacher", name: u.name, email: u.email});
    return {ok:true, redirect:"teacher.html"};
  }
}

// ---- signup ----
function signupStudent({name, roll, reg, dept, email, pass}){
  const db = currentDB();
  if(db.students.find(s => s.reg_no === reg)) return {ok:false, msg:"Registration no. already exists."};
  if(db.students.find(s => s.roll_no === roll)) return {ok:false, msg:"Roll no. already exists."};
  if(db.students.find(s => s.email === email)) return {ok:false, msg:"Email already exists."};
  db.students.push({
    reg_no: reg, name, roll_no: roll, dept, email,
    emailVerified: false, status: "active", section_id: null, createdAt: todayISO()
  });
  saveDB(db);
  // mock email verification token
  const token = uid("verify_");
  db.sessions.push({token, userId: reg, userType:"student_verify", expiresAt: new Date(Date.now()+86400000).toISOString()});
  saveDB(db);
  return {ok:true, msg:"Account created. Verification email sent (mock). Check console for token: "+token};
}

function signupTeacher({name, dept, email, pass}){
  const db = currentDB();
  if(db.teachers.find(t => t.email === email)) return {ok:false, msg:"Email already exists."};
  db.teachers.push({
    id: uid("tch_"), name, dept, email, passwordHash: pass, // mock: store plain for demo only
    status: "pending", createdAt: todayISO()
  });
  saveDB(db);
  return {ok:true, msg:"Account created as pending. Awaiting admin approval."};
}

// expose to window for inline handlers
window.attemptLogin = attemptLogin;
window.signupStudent = signupStudent;
window.signupTeacher = signupTeacher;
