# Greadter — Warnings & Tips

Running list of things to know about the codebase: setup steps, gotchas, known gaps.
Newest items go at the top of each section. Remove an item once it no longer applies.

## Needs your confirmation
- **Semester months are assumed, not confirmed.** The code assumes odd semesters (1, 3, 5, 7) run **August–January** and even semesters (2, 4, 6, 8) run **February–July**. If the university's terms start in different months, change `ODD_TERM_START_MONTH` (currently `8`) and `EVEN_TERM_START_MONTH` (currently `2`) in [js/auth.js](js/auth.js). Every semester label, the signup admission-year list and the "current batches" button depend on these two values.

## Before deploying
- **Run [db/schema.sql](db/schema.sql) in the Neon SQL Editor first** (re-run it after every schema change). It is idempotent and adds what the code needs (`admins` table, `students.password_hash`, `submissions.file_url`, `sections.batch_year`). Without it, uploads and student/admin login fail.
- **Nothing has been tested against the live database or a real deploy.** The code was only checked statically (no Node.js on the dev machine). Smoke-test signup, login, upload, publish and CSV after deploying.
- **After deploy, confirm `/backend/login.js` and `/db/schema.sql` return 404.** [vercel.json](vercel.json) blocks them with a status-only route; verify it works on Vercel.

## Reliability
- **The first request after the site sits idle can fail** with "The network connection was lost" or a slow response, then work on retry. Likely cause: Neon's free plan suspends the database after ~5 minutes idle, and waking it can take several seconds. A Vercel deployment that is still building or just failed causes the same symptom. Fix: retry, open the site once before testing, or disable auto-suspend on a paid Neon plan.
- **Roster import doesn't show why rows fail**, only "skipped". If a whole import fails at once, suspect the outage above and re-run it.

## Accounts & access
- **Admins must assign teachers to sections before teachers can do anything.** A teacher with no sections sees an empty dashboard and cannot create subjects.
- **Only the first admin can sign up publicly.** After that, new admins must be created by a logged-in admin.
- **Everyone must log in again** after the security update (old browser sessions are no longer accepted).
- **Existing and roster-imported students have no password.** They complete student signup with the same reg. no. and roll no. to set one.
- **Passwords must be at least 8 characters.** Old plain-text teacher/admin passwords still work and are hashed automatically on next login.
- **Students only see subjects from their own section or sections joined with a join code.** A student with no section sees a join-code box instead.
- **Roster import uses `<reg_no>@roster.local` as a placeholder email** when the CSV has none (the `students.email` column is NOT NULL and UNIQUE).

## Semesters & sections
- **Semesters are calculated, not stored.** A section stores its admission year (`batch_year`); the semester comes from that plus today's date. Odd semesters (1, 3, 5, 7) run August–January and even ones (2, 4, 6, 8) February–July. If the university calendar differs, change `ODD_TERM_START_MONTH` / `EVEN_TERM_START_MONTH` in [js/auth.js](js/auth.js).
- **Only four batches are active at a time.** In Nov 2026 that's 2026 → Sem 1, 2025 → Sem 3, 2024 → Sem 5, 2023 → Sem 7. Batches past semester 8 show as "graduated" and are hidden from the teacher-assignment checklist.
- **Each new academic year (August), create sections for the incoming batch.** On the admin page, pick the department and click "Add sections A + B for all 4 current batches"; existing sections are skipped, so it's safe to click any time.
- **Sections created before this change have no batch year** and show "no batch set". Delete and recreate them, or set `batch_year` in the database.
- **Section names must be unique per department and batch** (one A, one B, …). Student signup and roster import match sections by department code + admission year + letter, so the department codes must match the CSV `dept` column (`CSE`, `ME`, …).

## Data
- **Import only one of the two sample rosters.** [student_roster_cse.csv](student_roster_cse.csv) (24 CSE students: batches 2023–2026, sections A and B, 3 each) reuses reg. numbers from [student_roster.csv](student_roster.csv) for different people, so the second import would skip those rows. Both now have a `year` column (admission year); if it's missing, the year is read from the roll no. (`CSE-25-101` → 2025).
- **[student_roster.csv](student_roster.csv) is sample data and is not committed** (`.gitignore` ignores `*.csv`). Import it from the admin page → Student roster. Before importing, create departments with codes `CSE`, `ME`, `ECE`, `CE` and their A/B sections for the matching batches (use the bulk button); otherwise students are imported with no section. Re-importing skips rows whose reg. no., roll no. or email already exist. Replace the `@example.edu` emails with real ones for production.
- **Deletes cascade.** Deleting a department removes its sections; deleting a section removes its subjects; deleting a subject removes its topics, custom topics and all submissions. The admin page warns before each.
- **[csvscript.js](csvscript.js) writes to a `student_roster` table that isn't in the schema**, so it will fail if run. Roster import through the admin page works because it creates `students` rows directly. Either add a `student_roster` table or point the script at `students`.
- **Marks and topic totals must be whole numbers** (INTEGER columns). New topics default to 20 marks.

## Known gaps / not built yet
- No rate limiting on login attempts.
- Student signup does not check the class roster CSV.
- Email notifications and email verification are not built (the teacher "email" checkbox is disabled).
- OCR, AI grading and similarity detection are not built; `ai_marks`, `similarity_*` and `ocr_confidence` are never filled.
- `/api/topics` returns every topic to any logged-in user (the teacher page filters client-side), so topic titles from other sections are visible via the API.
- No Content-Security-Policy header: pages use inline scripts, and a wrong CSP would break uploads.

## Design
- **The redesign was only checked with static renders** (macOS Quick Look, no JavaScript, no web fonts, desktop width). Logged-in dashboards with real data, phone widths and the live fonts haven't been viewed yet. Click through student, teacher and admin pages on desktop and phone after deploying.
- **Fonts load from Google Fonts** (Atkinson Hyperlegible, Kalam). If they're blocked, pages fall back to system fonts and still work. Visitors' browsers contact Google to fetch them; self-host the font files in `css/` if that matters for privacy.
- **The design rules live at the top of [css/style.css](css/style.css)** as colour variables. Red (`--red`) is reserved for the margin line, marks and destructive actions; red margin numbers are only for real step sequences. Keep both rules so the exercise-book look stays consistent.

## Dependencies
- The student upload page loads `@vercel/blob@2.9.0/client` from esm.sh (pinned). Bump it together with `@vercel/blob` in [package.json](package.json).
