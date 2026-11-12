-- ============================================================
-- Greadter — Neon schema (source of truth for the backend)
-- Safe to run repeatedly in the Neon SQL Editor: every statement is idempotent,
-- and the "Upgrades" block brings an existing database up to date.
-- ============================================================

-- 0. Admins (used by /api/login, /api/signup, /api/me)
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 1. Departments
CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2. Sections (tied to a department and an admission batch).
--    batch_year = admission year (e.g. 2025). The semester is NOT stored: it is
--    computed from batch_year and today's date (see semesterOf in js/auth.js),
--    so sections move from semester 1 → 2 → … → 8 automatically.
--    Usually two sections ("A", "B") per department per batch.
CREATE TABLE IF NOT EXISTS sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    batch_year INTEGER CHECK (batch_year BETWEEN 2000 AND 2100),
    join_code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Teachers (signup → status 'pending'; admin approves to 'active')
CREATE TABLE IF NOT EXISTS teachers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dept TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive')),
    flag_settings JSONB,      -- {"ai_text": 50, "similarity": 30}: when this teacher's lists flag work
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 4. Students (reg_no is the unique identifier).
--    password_hash is NULL for roster-imported students until they complete signup.
CREATE TABLE IF NOT EXISTS students (
    reg_no TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    roll_no TEXT NOT NULL UNIQUE,
    dept TEXT,
    email TEXT UNIQUE NOT NULL,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
    section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
    password_hash TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 5. Teacher ↔ Section mapping (one teacher can teach many sections)
CREATE TABLE IF NOT EXISTS section_teachers (
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    PRIMARY KEY (teacher_id, section_id)
);

-- 6. Subjects (each subject belongs to one section)
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    assignment_mode TEXT NOT NULL DEFAULT 'single' CHECK (assignment_mode IN ('single','multiple','custom')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 7. Topics (teacher-created topics inside a subject)
CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    overview TEXT,
    requirements TEXT,
    total_marks INTEGER NOT NULL,
    deadline DATE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 8. Custom topics (student-created, Mode 3 only)
CREATE TABLE IF NOT EXISTS custom_topics (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    student_reg_no TEXT NOT NULL REFERENCES students(reg_no) ON DELETE CASCADE,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 9. Submissions (topic_type = 'teacher' or 'custom').
--    topic_id has no FK because it points at topics OR custom_topics.
--    file_url is the private Vercel Blob URL of the uploaded file.
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL,
    topic_type TEXT NOT NULL DEFAULT 'teacher' CHECK (topic_type IN ('teacher','custom')),
    student_name TEXT NOT NULL,
    roll_no TEXT NOT NULL,
    reg_no TEXT NOT NULL REFERENCES students(reg_no) ON DELETE CASCADE,
    dept TEXT,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    size_kb INTEGER,
    file_url TEXT,
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    late BOOLEAN NOT NULL DEFAULT FALSE,
    ai_marks INTEGER,
    teacher_marks INTEGER,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    similarity_group TEXT,
    similarity_pct INTEGER,
    feedback JSONB NOT NULL DEFAULT '[]'::jsonb,   -- teacher feedback the student sees once published
    ai_review JSONB,          -- AI pipeline output, teachers only (shape: db/ai_review.md)
    verified_at TIMESTAMP,    -- set when a teacher confirms the mark; publishing requires it
    verified_by TEXT,         -- teacher or admin id
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 10. Student ↔ Section enrollment (join codes). A student's sections are
--     students.section_id plus every row here.
CREATE TABLE IF NOT EXISTS enrollments (
    student_reg_no TEXT NOT NULL REFERENCES students(reg_no) ON DELETE CASCADE,
    section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_reg_no, section_id)
);

-- 11. Auth sessions (token is 64 random hex chars)
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_type TEXT NOT NULL CHECK (user_type IN ('student','teacher','admin')),
    expires_at TIMESTAMP NOT NULL
);

-- ============================================================
-- Upgrades for databases created from the earlier schema
-- ============================================================
ALTER TABLE students    ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE teachers    ADD COLUMN IF NOT EXISTS flag_settings JSONB;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_review JSONB;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE sections    ADD COLUMN IF NOT EXISTS batch_year INTEGER CHECK (batch_year BETWEEN 2000 AND 2100);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_submissions_reg ON submissions(reg_no);
CREATE INDEX IF NOT EXISTS idx_submissions_subject ON submissions(subject_id);
CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_subjects_section ON subjects(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_department ON sections(department_id);
-- One "A", one "B", … per department per batch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sections_dept_batch_name ON sections(department_id, batch_year, name);
CREATE INDEX IF NOT EXISTS idx_custom_topics_subject ON custom_topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON enrollments(student_reg_no);
CREATE INDEX IF NOT EXISTS idx_section_teachers_teacher ON section_teachers(teacher_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
-- sessions.token is the primary key, so it already has an index.
DROP INDEX IF EXISTS idx_sessions_token;
