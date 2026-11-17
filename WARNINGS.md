# Greadter — Warnings & Tips

Running list of things to know about the codebase: setup steps, gotchas, known gaps.
Newest items go at the top of each section. Remove an item once it no longer applies.

## Needs your confirmation
- **Semester months are assumed, not confirmed.** The code assumes odd semesters (1, 3, 5, 7) run **August–January** and even semesters (2, 4, 6, 8) run **February–July**. If the university's terms start in different months, change `ODD_TERM_START_MONTH` (currently `8`) and `EVEN_TERM_START_MONTH` (currently `2`) in [js/auth.js](js/auth.js). Every semester label, the signup admission-year list and the "current batches" button depend on these two values.

- **AI provider: wired to Claude for now, model not final.** "Run AI check" calls Claude through [backend/ai.js](backend/ai.js), the only provider-specific file. Set `ANTHROPIC_API_KEY` in Vercel (checks report "not set up" without it) and optionally `AI_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` is far cheaper). Cost per 1,000 assignments, Nov 2026 prices, ~4.5K tokens in / ~3.5K out each: Haiku 5.5 ~$2, Sonnet 5.5 ~$44, Opus 5.5 ~$88 at full price (the Batch API would halve this but isn't used: checks run when a teacher clicks). Before settling on a model, compare Haiku and Sonnet against teacher marks on ~20 real assignments.
- **Decided: reg. no. + roll no. is enough to sign up for now.** Anyone who knows both for a student who hasn't signed up yet could claim that account. Planned next: email verification. Students may use a personal email (universities don't issue student emails), so verification must work with any address.
- **Decided: teachers may use a university or personal email.** The sign-up and log-in pages say so; the server accepts any valid address. Admin approval is what controls who becomes a teacher, so check new teachers' names and emails before approving.

## Before deploying
- **Run [db/schema.sql](db/schema.sql) in the Neon SQL Editor first** (re-run it after every schema change). It is idempotent and adds what the code needs (`admins` table, `students.password_hash`, `submissions.file_url`, `ai_review`, `annotations`, `verified_at`, `corrections`, `sections.batch_year`, `teachers.flag_settings`, and the `notifications` table). Without it, uploads and student/admin login fail.
- **Publishing now requires a verified mark.** After you re-run the schema, any submission that was published before this change but never verified is hidden from students until a teacher opens it, verifies and publishes again.
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

## AI review
- **AI checks only run when a teacher asks**: "Run AI check" on a submission, or select several and "Run AI check on selected" (two at a time; keep the page open until it finishes). Re-running replaces the AI's issues and suggested mark; issues the teacher added stay.
- **Time limit: 180 seconds per check** (`maxDuration` in [vercel.json](vercel.json); every Vercel plan allows up to 300, Pro/Enterprise up to 800). A 20-page PDF is roughly 60,000–100,000 tokens in; checks are expected to take about 30–90 seconds, with 2–3 minutes as a worst case. Model output speeds aren't published, so this is an estimate: each check records `pages` and `duration_ms` in `ai_review`, so tune the limit from real numbers. The AI call stops itself at 160 seconds (no retries) so a slow check is reported as "took too long" instead of being cut off. Checks stuck "processing" for 10 minutes show as stopped and can be run again.
- **Uploads: PDF only, up to 8 MB and 20 pages, typed or scanned** (`MAX_UPLOAD_BYTES`, `MAX_PAGES` in [backend/auth.js](backend/auth.js); the student page checks both before uploading, and the AI check refuses over 20 pages). A typed 20-page assignment is usually under 2 MB; 20 scanned or photographed pages are usually 4–8 MB at 150–200 dpi. The rejection message tells students how to shrink larger files.
- **Scanned PDFs are marked, but not checked for copying.** The AI reads scans from the page images, so marking and AI-text estimates still work. Similarity compares the PDFs' text, and scans have none, so a scan never shows a match (in either direction).
- **Every issue is tied to a page and a location in words** ("Paragraph 2, second sentence"). Placement on the page: exact words found → red mark; words not found but the AI gave a box (scanned pages) → dashed red box marked approximate; neither → a numbered pin in the page's top corner. Teachers can't select text on scanned pages, so they mark them with "Mark a diagram" boxes.
- **The marked PDF shows the same placements**: red boxes, dashed boxes for approximate ones, and numbered pins at the top of the page for issues without a position, with each issue's location on the notes page.
- **Published marks can be corrected, with a reason.** On a published submission's review page, "Correct this mark" unlocks the mark, comment and issues; saving needs a reason the student sees. Every correction is kept in `submissions.corrections` (when, by whom, old and new mark, reason, what changed) and shown to the teacher; the student sees when, old and new mark and the reason (not who), on their page and on the marked PDF's notes page. A published mark can't be unpublished, and the AI check can't be re-run on it.
- **The marked PDF students download is built on request** from the original file plus the issues ([backend/marked_pdf.js](backend/marked_pdf.js)). Pages rotated in the PDF get their issues on the notes page only. Characters outside Latin-1 (e.g. non-Latin scripts) show as "?" on the notes page, because it uses the standard PDF font.
- **AI-text detection is a hint, not evidence.** Detectors wrongly flag real writing, especially by non-native English speakers. The UI says so; don't let it drive penalties on its own.
- **Each teacher sets their own flag thresholds** under Check submissions, "When to flag work". Defaults are 50% AI-like and 30% similar. They only decide which submissions get a tag and move up that teacher's list; the review page always shows every score and students never see flags. The panel shows how many current submissions each level flags, so tune after the first real batch (e.g. raise similarity to ~40% if honest work typically overlaps 20–35%). Saved per teacher account (`teachers.flag_settings`); re-run the schema to add the column.
- **Students never receive AI output.** The student API returns an allow-list of fields, and only shows marks and feedback that a teacher has verified and published. If you add columns to `submissions`, they stay hidden from students unless added to `forStudent` in [backend/submissions.js](backend/submissions.js).

## Not built yet
- **Email verification.** Planned next. Until then, anyone who knows a student's reg. no. and roll no. could claim that student's account if they haven't signed up yet. It must work with personal email addresses.
- **Email notifications.** The groundwork is in place: every publish and correction writes a row to the `notifications` table, and students see unread ones as notices on their page (dismissable). To add email, build a sender that sends rows where `emailed_at IS NULL` and sets `emailed_at`; no other change is needed. Students may use personal emails, so send to `students.email`. The teacher "email" checkbox stays disabled until then.
- **Rate limiting** on login attempts and on the registration-number lookup (`/api/roster`). The lookup only reveals a masked name, department and section, but both need limits before a public launch.
- **Topic privacy.** `/api/topics` returns every topic to any logged-in user (the teacher page filters on screen), so topic titles from other sections are visible through the API.
- **Reasons for failed roster rows.** Roster import only says how many rows were skipped, not why (duplicate, missing section, server error).
- **[csvscript.js](csvscript.js) doesn't work.** It writes to a `student_roster` table that isn't in the schema. Fix it to write to `students`, or delete it: the admin page's roster import already does the job.
- **No Content-Security-Policy header.** Pages use inline scripts, so a CSP needs care; a wrong one would break uploads and the PDF viewer.

## Design
- **The redesign was only checked with static renders** (macOS Quick Look, no JavaScript, no web fonts, desktop width). Logged-in dashboards with real data, phone widths and the live fonts haven't been viewed yet. Click through student, teacher and admin pages on desktop and phone after deploying.
- **Fonts load from Google Fonts** (Atkinson Hyperlegible, Kalam). If they're blocked, pages fall back to system fonts and still work. Visitors' browsers contact Google to fetch them; self-host the font files in `css/` if that matters for privacy.
- **The design rules live at the top of [css/style.css](css/style.css)** as colour variables. Red (`--red`) is reserved for the margin line, marks and destructive actions; red margin numbers are only for real step sequences. Keep both rules so the exercise-book look stays consistent.

## Dependencies
- **New packages:** `@anthropic-ai/sdk` (AI checks) and `pdf-lib` (marked PDFs) in [package.json](package.json). Vercel installs them on deploy.
- **pdf.js 3.11.174** is loaded from cdnjs on the review, teacher and marked-work pages to show PDFs. If it fails to load, those pages say so and teachers can still download the file.
- **Uploads are PDF only.** Older non-PDF submissions still download, but can't be checked by AI or marked on the page.
- The student upload page loads `@vercel/blob@2.9.0/client` from esm.sh (pinned). Bump it together with `@vercel/blob` in [package.json](package.json).
