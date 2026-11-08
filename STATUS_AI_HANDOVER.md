Status AI: handover summary
State as of 2026-11-08. Everything below was checked against the repo just now, except where marked "from earlier rounds".
READ SECTION 12 FIRST (at the end of this file): it is the authoritative current state as of the end of the 2026-11-08 session and supersedes older sections where they disagree.

1. Read this first: the project at a glance
Status AI is an AI-powered project reporting workspace, deliberately not a project management tool. A Project Manager pastes rough updates and gets a structured seven-section executive report. They edit it, save it against a project, and export or share it.

Repo	C:\Users\AminaOkeleye\OneDrive - Omniswift Limited\Desktop\status-ai
GitHub	https://github.com/ameenahdee/status-ai (branch main)
Git identity (repo-local)	Amina Okeleye ameenahdee@gmail.com
Local credential override	credential.username = ameenahdee. The global Git config still says Samantha, and I never changed it.
Stack	React 19 + Vite, Express 5, Google Gemini via @google/genai, jsPDF, localStorage, Node ≥ 22.12 (you run Node 26)
Deployment	Not deployed. Plan is Render free tier.
Live Gemini generation	Off by default in production. Needs LIVE_GENERATION_ENABLED=true, and you said not to enable it publicly until Google's terms are reviewed.
2. Git status and history
Pushed history (origin/main = 8a9db5a; the What Changed work below is uncommitted until approved):

Commit	Message	Content
1af18f4	Initial Status AI MVP	31 files: app, Gemini provider, projects/reports/demo data model, PDF/copy/email, logo, README
0c48ce3	Harden app for demo deployment	Security headers/CSP, asset caching, engines, rate-limiter pruning, global daily cap, LIVE_GENERATION_ENABLED switch, privacy notice
b2949e5	Improve public demo experience	Try a Sample Generation, Save a Copy, honest sample labelling, samples.js, SaveCopy.jsx, README demo docs
Each commit carries the trailer Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>.

Fourth commit (pushed to origin/main as 9397f90): "feat: add automated tests, storage reliability, versioned data model and generation metadata". It contains, as one commit, the test suite, the storage reliability fixes, the version 2 data model (schema.js, history.js), generation metadata and safe report deletion, plus the handover. The work was originally planned as three commits, but the stages share the same functions in store.js and the same tests, so they could not be split without writing untested intermediate code.
Ignored and local only: .env, dist/, node_modules/. .env has AI_PROVIDER, GEMINI_API_KEY, GEMINI_MODEL, PORT, and GEMINI_MODEL is now gemini-3.5-flash. I never read or modified .env, and I never print the key.
Line endings: every Git command warns "LF will be replaced by CRLF". It is harmless (core.autocrlf=true).
3. Architecture
Frontend (src/)
Routing: custom hash router (router.js: useRoute, navigate, scrollToId). There is no routing library.
Pages and shell:
App.jsx: shell, mobile drawer under 900px, StorageBanner, page routing.
Overview.jsx: the redesigned dashboard (see "Dashboard redesign" in the latest update section). dashboard.js: pure functions for its figures, recent reports and activity. icons.jsx: line icons.
Projects.jsx: project directory, 6 per page, create/edit form, workspace, demo load/reset.
Reports.jsx: library (All/Recent/By Project, search) and report view.
Composer.jsx: new-report flow, live generation, sample generation.
SaveCopy.jsx: Save a Copy dialog.
Support modules:
ui.jsx: Modal with exit transition, Menu, ReportBody, ReportCard, StatusBadge, Toast, ConfirmDialog, DemoBadge.
sections.js: the seven sections, fallbacks, text helpers.
exporters.js: copy / email / PDF output and metaOf.
pdf.js: jsPDF, lazy-loaded.
demo.js: demo workspace data.
samples.js: prepared sample scenario.
Logo.jsx: shows the SUPPLIED original logo as images (public/logo-on-dark.png for the plum sidebar, public/logo-on-light.png for the mobile top bar). The earlier hand-drawn SVG ribbon-S and its SVG files were removed because they were not the original logo.
State: store.js is a module-level singleton using useSyncExternalStore. All changes go through commit().
Design system (dashboard redesign adds sidebar #3F043E and page background #FBF7FC, see section 9): Plum #351044 (hover #481653, light #60216F), pink #D94C9B (light #FCE7F3), background #FAF8FB, borders #E5DFE8, text #241B29 / #756C7A, Inter font. Mobile-first CSS with breakpoints at 560, 640, 800, 900 and 1180px. It respects prefers-reduced-motion.
Backend (server/)
Files: index.js (Express app), limits.js, prompt.js, providers/index.js, providers/gemini.js.
Endpoints:
GET /api/health → {ok, error?}, always HTTP 200.
POST /api/report.
Any other /api/* → JSON 404 {error:'API endpoint not found.'}.
Non-API paths serve dist/ with an SPA fallback.
POST /api/report pipeline: validate → live-enabled check → provider check → per-IP limit → daily cap → Gemini.
Request: {updates, projectName, projectDescription, audience, periodStart, periodEnd}.
Success response: {original, report}. original is the raw submitted text.
Error contract:
{error:string} with codes 400 (bad input), 413 (body over 50KB), 429 (IP limit, daily cap or quota), 503 (busy / not configured / code:'DISABLED'), 504 (provider timeout), 502 (other provider failure).
Only DISABLED has a machine-readable code.
Provider interface: generateReport(input), selected by AI_PROVIDER.
gemini.js builds the prompt with buildPrompt().
It uses a structured responseSchema and a 45s AbortSignal.timeout.
The system prompt enforces "facts only", the Suggested: prefix, and the exact empty-section sentences.
The prompt contract comment in providers/index.js is stale.
Security: x-powered-by is off. A strict CSP allows only this origin plus Google Fonts. It also sets X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy and COOP, plus HSTS only when req.secure. trust proxy is 1. API responses are Cache-Control: no-store. Hashed assets are immutable, 1y, HTML is no-cache, and other static files cache for a day. There is no compression, so the host must do it.
Environment variables:
Variable	Default / behaviour
GEMINI_API_KEY	required, server-side only
GEMINI_MODEL	gemini-3.5-flash (verified working; see Section 7)
GEMINI_TIMEOUT_MS	45000
AI_PROVIDER	gemini
PORT	3001
DAILY_REQUEST_CAP	200 (UTC day, in memory)
LIVE_GENERATION_ENABLED	on outside production, off in production unless true / 1 / yes
NODE_ENV	production switches the live default off
Data model (localStorage key statusai.v1: {version:2, projects[], reports[], statusHistory[]}; version 1 data is migrated on load)
Project:

Fields: id (UUID; demo uses demo-p-01…10), name, startDate, description (required, ≤ 500), owner, audience, status (On Track | At Risk | Blocked | Off Track | null), statusSource ({type:'manual'|'report'|'ai-confirmed', reportId?, at, historyId?} or null), createdAt, optional demo.
Create path: createProject is for createProject only.
Not defined: there is no delete-project action and no definitions for the four statuses anywhere.
Report:

Fields:
Identity: id (UUID; demo uses demo-r-PP-N), projectId, title.
Source text: originalUpdate (immutable).
Period and timing: periodStart, periodEnd, generatedAt (server AI generation time, null if unknown), savedAt (first saved), updatedAt (last edit).
Provenance: source ('ai' | 'demo' | 'sample-copy'), optional demo, sampleCopy, copiedFrom.
Status: projectStatusAtReport (PM-chosen snapshot).
Body: content = {title, executiveSummary: string, completedActivities, workInProgress, blockers, risks, nextSteps, executiveActionRequired: string[]}.
Edit semantics: editing overwrites content only. generatedContent (the AI output as produced), originalUpdate, generation ({model, promptVersion} or null) and the timestamps other than updatedAt never change. provenance records how each value is known (recorded, recovered, unknown, not-applicable).
Placeholders: Not specified in the submitted update. and No executive action required at this time. are stored as real items.
Demo workspace:

Shape: 10 fictional projects and 13 reports, with dates relative to today. The status mix is 4 On Track, 3 At Risk, 2 Blocked, 1 Off Track. One project has no reports.
Load and reset: loadDemo is idempotent by ID. resetDemo removes demo records and sample copies. A demo project that holds a user-saved report is kept and converted to a normal project.
Store actions:

Projects: createProject, updateProject, setProjectStatus.
Reports: addReport, saveSampleCopy, updateReportContent, deleteReport.
Demo and persistence: loadDemo, resetDemo, retrySave.
Extras: hasDemo, reportsFor (sorted by generatedAt desc), STATUSES, DESCRIPTION_MAX.
Persistence behaviour (committed in 9397f90, tested)
Failed writes: getPersistence() returns {ok, reason, notice}. A failed write sets reason:'write-failed', keeps the app usable in memory, and recovers on the next successful write or retrySave().
Unreadable storage: the app sets read-blocked and suspends all writes, so nothing is overwritten.
Corrupt or malformed data (invalid JSON, wrong shape, or invalid records inside valid lists):
Valid records load byte-for-byte.
Invalid and duplicate-id records are dropped.
The original raw text is first copied to statusai.v1.set-aside.
A notice with counts is shown.
Existing backup protection: an existing backup is never overwritten.
If a different corrupt value appears, writes are suspended with reason:'backup-exists', and both the backup and the new unreadable data stay untouched.
If the backup slot itself can't be read or written, the reason is cannot-preserve.
An identical backup is left alone, and an empty slot counts as no backup.
UI surfacing (in App.jsx):
A red alert banner appears for write-failed, read-blocked, cannot-preserve and backup-exists. Only write-failed has "Try saving again".
A dismissible info notice appears for recovered records.
"Report saved", "Sample copy saved" and "Changes saved" become "NOT saved to this browser" warning toasts when persistence is failing.
Demo and sample experience (committed)
Try a Sample Generation: loads a fictional update into the real form (period prefilled). "Generate sample report" then shows a pre-written, seven-section report with no network call. Editing the input reverts the button to live Generate.
Entry points: ?sample=1 and the Overview "Try a Sample Generation" button preload the input only.
Save a Copy: available on sample drafts and on demo reports.
A separate record is created: source:'sample-copy', demo:true, sampleCopy:true, copiedFrom, deep-cloned content, edits preserved, original untouched.
It defaults to the report's own demo project, and a repeat save warns first.
The double-click guard is a useRef.
Labelling:
dateLabel() returns Generated / Dated / Saved.
Overview says "Reports saved" with a "N live AI · M demo or sample" split.
Exports of illustrative reports say "SAMPLE REPORT – illustrative output, not generated live" and omit "Generated:".
4. Completed work, by stage
Done and committed:

Scaffold and Gemini provider (the original Anthropic SDK was removed).
MVP app: seven sections, edit, copy, PDF, email draft, sample report, error handling (503/429/504).
Product workspace: Overview, Projects, Reports library, project workspace, reporting periods, localStorage, brand logo and favicon rebuilt from your reference as a folded ribbon.
Demo workspace with pagination, mobile-first redesign with a drawer, micro-interactions.
Required project description (≤ 500) that is passed to the AI as background context.
Deployment hardening, privacy notice, live-generation switch, daily cap.
Public demo experience (sample generation and Save a Copy).
Fixes that came out of debugging:
useEffect returning window.scrollTo (blank screen).
The hanging gemini-3.8-flash model, now fixed with a timeout and a default of gemini-3.5-flash.
ECONNRESET was caused by that missing timeout.
Done and committed in the fourth commit (9397f90, pushed):

Version 2 data model (src/schema.js, src/history.js, src/store.js):
CURRENT_VERSION = 2 with migrateV1toV2. Version 1 data upgrades on the first write and the raw v1 text is kept in statusai.v1.pre-v2. Nothing is dropped.
Reports now have savedAt (first saved), generatedAt (the server's AI generation time, null when unknown), updatedAt (last edit), generatedContent (the AI output exactly as produced, immutable) and content (the editable version). originalUpdate is immutable.
A provenance object says how each value is known: recorded, recovered, unknown or not-applicable. Migrated v1 reports: generatedAt is null/unknown, generatedContent is recovered only if the report was never edited, otherwise null/unknown. Demo and sample copies are not-applicable.
statusHistory (state-level list): every confirmed status change is recorded with previous/new status, time, source (manual, report or ai-confirmed) and optional reportId. A migrated anchor entry (one per project with a known status, previousStatusKnown:false) is created deterministically. An AI recommendation is not a source, so it can never change a status.
history.js: previousReportFor (same project, by period end, excluding demo and sample copies, with duplicate/overlap/back-fill flags and statuses found/none/unavailable), historyFor, latestByPeriod, statusHistoryFor, reportRefState.
Generation metadata: the server returns model and promptVersion from POST /api/report (PROMPT_VERSION in server/prompt.js, pinned by a test hash so the prompt cannot change without a bump). Composer passes them to addReport, which stores generation:{model,promptVersion} with provenance.generation = recorded. Missing values are null/unknown. Migrated live reports are null/unknown. Demo, sample and sample-copy reports are null/not-applicable. A v2 record with no generation field is left alone and read as unknown. Never guessed.
Safe deletion: deleteReport keeps status-history entries that point at the report and marks them reportDeleted/reportDeletedAt. The project's current status and statusSource are not changed. The project page shows "(since deleted)". previousReportFor returns unavailable/report-not-found for a deleted target and never returns a deleted report. Reloading a deleted demo report clears its mark.
Project-context snapshot: deliberately deferred.

Automated test foundation (Node's built-in runner, no new packages).
Four reliability gaps fixed:
Failed saves reported: getPersistence(), banner, honest toasts, retry.
Unreadable storage: writes suspended, nothing overwritten.
Malformed records: filtered, set-aside backup, notice.
Description cap: capDescription applied to create and update, DESCRIPTION_MAX = 500 shared with the form.
Unknown API routes: JSON 404 catch-all.
Existing set-aside backup is never overwritten (backup-exists / cannot-preserve).
test/email-draft.test.mjs: 9 tests of the real emailReport() against a fake window.
README: Testing section, scripts table, storage/privacy notes, a warning about the Email draft in browser tests.
5. Testing
Repo suite (npm test): 756 tests (568 before What Changed), all pass, about 20s. npm run lint is clean and npm run build passes. Mutation checks on throw-away copies confirmed that the main rules are each caught by tests when broken: deletion marking, generation metadata, evidence verification, the update-evidence requirement, no default to On Track, the decision action, the Project Health export line, the demo exclusion, the store-level status guard, resolved-without-current-quote kept, current quote not checked, evidence leaking into exports, and demo reports exporting the section.
Browser verification (headless Edge, last run 2026-11-09, no real Gemini call): 41 of 41 for v1 migration, report deletion and stubbed live generation; 42 of 42 for the health assessment and mandatory status; 49 of 49 for What Changed and project health movement (first report, comparison with a previous report including new, resolved, omitted-not-resolved and invented items, demo/sample exclusion, comparison failure fallback, period changed after generating, copy text, saved report page). Scripts are browser-check.mjs, assess-check.mjs and changes-check.mjs in the session scratchpad, NOT in the repo, and may be lost. Email draft was never clicked.
Earlier history: the first test foundation had 258 tests.

Commands:
npm test
npm run test:watch
npm run test:coverage (indicative only: it can't see server/index.js or the fresh store copies)
npm run lint (clean)
npm run build (passes)
Design:
Store tests use an in-memory fake storage and a fresh store.js import per test.
API tests spawn the real server as a child process with test/helpers/genai-stub.mjs preloaded. It replaces fetch, supports modes ok | 503 | 429 | 500 | badjson | empty | hang, blocks every non-Gemini host, and the harness's stop() fails the test if any blocked call was attempted.
The child runs in an empty temp folder (so your real .env is never read) with a fake key.
Mutation testing was done on throw-away copies: every fix has been verified to fail the right tests when broken.
Browser verification scripts (NOT in the repo; they live in the session scratchpad and may be lost on compaction): qa.mjs, sample.mjs, harden.mjs, ui-storage.mjs, ui-backup.mjs, http.ps1, mailto-guard.mjs and more.

Method: headless Edge driven over the DevTools protocol, run against a production-default server (NODE_ENV=production), so no Gemini call is possible.
Last results: sample.mjs 81/81, qa.mjs all 159/160, harden.mjs disabled 18/18, ui-storage.mjs 33/33, ui-backup.mjs 12/12, http.ps1 26/26.
Known false failure: the single qa.mjs miss is its old "PDF export triggers a download" check. The real-download PDF check inside harden.mjs passes.
Email draft safety (important):
Clicking "Email draft" in a real browser opens Outlook.
Browser-level blocks (Navigation API, CSP sandbox, profile prefs) do not work.
The working method is rewriting the single window.location.href = \mailto:…`` line as the test browser loads the script, plus a pre-click safety gate.
6. Constraints and working agreements (keep following these)
Do not commit, push or deploy without explicit approval. Always show the staged file list first, and stage by name, never git add ..
Never modify .env, API keys, Gemini settings or deployment config unless told to, and never print secrets.
No package installs or lockfile changes without approval. Component-testing dependencies (jsdom and similar) were explicitly excluded so far.
Do not deploy to Render. Do not enable live generation publicly.
Preserve the existing design system, the seven-section structure, demo behaviour and sample-versus-live distinctions. Sample content must never be presented as AI-generated.
Keep scope tight: no unrequested features. Stop and explain if a task needs an architectural decision.
Commits: add the Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com> trailer. Use the exact message the user specifies.
Do not run browser tests that click Email draft without the interceptor.
Environment quirks:
Windows PowerShell 5.1.
The Bash tool breaks on some quotes and backticks, so write scripts with the file tool.
Edit requires a prior Read of the file.
npm run dev may be running twice, with a stray node server/index.js on port 3001 (flagged to you, not killed).
Git credential helper: the first push needed your interactive browser sign-in as ameenahdee.
7. Technical decisions worth remembering
Model choice: gemini-2.5-flash returns 404 for new accounts and gemini-3.8-flash hangs. gemini-3.5-flash was verified fast (about 1–7s). gemini-3.7-flash and gemini-flash-latest also stalled. Model availability changes, so re-check if generation stalls.
No SDK retries: one provider attempt per request. The 45s timeout fails with 504.
Live-generation switch: off in production by default. This was my judgment call to honour "don't expose live generation until the terms are reviewed". You can drop it, but it was kept.
Persistence design: in-memory continues after a failed write, with a banner. It does not roll back. Unreadable data suspends writes. Set-aside is a single newest-only slot, protected from overwrite.
Sidebar note "Data is saved in this browser only." was explicitly left unchanged. It can be misleading while the red banner is showing.
History ordering: reportsFor sorts by save time (generatedAt), not by reporting period. It is a documented characterisation, not an endorsement.
8. Pending, in priority order
Needs your approval before anything else:

1. Review and approve committing the What Changed work (uncommitted). Nothing is deployed.
Deployment (not started):
2. Review Google's current Gemini API terms (age requirements, free-tier data use) and decide an operating arrangement. Keep LIVE_GENERATION_ENABLED unset in production until then.
3. Render free web service, steps from the earlier audit:

Fresh Gemini key (no billing attached).
Build npm ci --include=dev && npm run build, start npm start.
Env: GEMINI_API_KEY, GEMINI_MODEL=gemini-3.5-flash, AI_PROVIDER=gemini, NODE_VERSION=22, optionally DAILY_REQUEST_CAP. Do not set PORT.
Health check path /api/health.
After deploy, check compression headers and whether trust proxy gives per-visitor IPs.
First load after idle takes about a minute (free tier spin-down).
Possibly add a /health alias. The route is /api/health, and plain /health falls through to the SPA's HTML.
Known gaps and risks (not yet fixed):
5. Multi-tab overwrites (no storage event handling).
6. No in-app way to view or restore set-aside data.
7. Save Report and Create Project have no double-submit guard (code review only, never tested). Save a Copy does.
8. (Resolved) generatedAt is now the AI generation time and savedAt is the save time.
8a. No UI yet lists a project's status history, so the "deleted" marking is only visible as "(since deleted)" on the project page.
8b. The browser verification script is not in the repo.
8c. The README does not yet describe the v2 fields or the generation metadata.
9. Sidebar note wording vs the red banner.
10. Section definitions are duplicated in server/prompt.js and src/sections.js.
11. providers/index.js contract comment is stale.
12. public/icons.svg is an unused Vite template asset, kept on request.
13. The server has no compression, and the in-memory limiters reset on restart.
14. The coverage report under-counts.
15. No automated UI/component tests, so the banner and toasts are only verified by the out-of-repo scripts.

9. Next phase
Do not build any of this without approval. Sequence:

Step 0: DONE (test foundation and storage fixes, commit 9397f90).
Step 1, data foundation: DONE except the items below.
Done: schema version and migration in load(); immutable generatedContent next to the editable content; generation metadata (model, promptVersion); statusHistory; previousReportFor; safe report deletion.
Still open from Step 1: export/import backup; the project-context snapshot (deferred on purpose); an optional empty sources[] for later Slack provenance. The four status definitions are now written (see section 6).
Step 2, AI Project Health Assessment: DONE (uncommitted until approved). See "AI Project Health Assessment (built)" in section 6.
Step 3, What Changed: DONE (uncommitted until approved). See "What Changed Since Last Report (built)" in section 6. Remaining decision: whether to ever compare against more than one previous report or the raw update.
Step 4, Slack: blocked until you decide on server-side storage and identity. The current server stores nothing, has no users and no credential storage, and "no accounts" conflicts with OAuth.
Decisions I still need from you (from the audit):

Definitions and criteria for the four statuses, and whether "insufficient information" is its own state.
Confirmation that the AI may only recommend, never auto-apply.
How to define "previous report" (period end vs save time; gaps, back-fills, duplicates).
Comparison baseline: PM-edited report, original AI output, raw update, or all.
Retaining original AI output and generation metadata (storage and privacy), and how to treat old reports without it.
Evidence rules, one AI call versus several (quota and latency).
Durability: stay browser-only with export/import, or move to server storage before Slack.
Privacy of sending more text (previous reports) to Gemini: DECIDED for now. Only the saved text of the single previous report of the same project is sent with the generation request (see section 6). Revisit before any public live generation.
Whether to show illustrative assessments and comparisons in the demo.
Slack scopes, retention and identity.
10. Exact next steps when we resume
Ask which you want first: (a) commit the What Changed work (after approval), (b) begin deployment prep once the Google terms review is done, or (c) the next product feature (Step 4 Slack needs server-side storage and identity decisions first).
If (a): run git status, lint, build and tests, show the file list, then commit only with approval. Push only with explicit approval.
If (b): review the Render steps and the Google terms first. Do not enable live generation publicly until the terms are reviewed.
Keep every task read-only until you approve changes.
# LATEST DEVELOPMENT UPDATE — NOVEMBER 8, 2026

## 1. Automated Testing Foundation

Status AI now has a permanent automated test suite using Node's built-in test runner.

- Run with `npm test`.
- Watch mode: `npm run test:watch`.
- Coverage: `npm run test:coverage`.
- No new packages were installed.
- No lockfile changes were made.

Latest reported results:
- 756 automated tests passing (258 when the test foundation was first built).
- 0 failing tests.
- Lint passes.
- Production build passes.
- 41 of 41, 42 of 42, 49 of 49, 33 of 33 (editing a saved report's Project Health) and 51 of 51 (health assessment, now collapsible) headless-browser checks passed (migration, deletion, stubbed live generation, health assessment, mandatory status, What Changed).
- No real Gemini API calls during automated testing or browser checks.

The tests cover project management, report management, demo functionality, persistence, storage failures, API behaviour, rate limits, security headers, exports and email draft generation.

## 2. Data Reliability Improvements

The following issues have been addressed:

1. Failed storage writes no longer falsely report success.
2. Unreadable browser storage is protected against accidental overwriting.
3. Malformed project and report records are handled safely.
4. Project descriptions have consistent 500-character validation on creation and editing.
5. Unknown API routes return standard JSON errors.
6. Existing set-aside backups are never silently overwritten.

When an existing backup contains different data, the application suspends writes to protect both the existing backup and newly unreadable data.

There is no recovery interface yet.

## 3. Email Draft Test Isolation

The Email Draft feature uses a `mailto:` link to open the user's default email application.

Automated browser tests were unintentionally launching Outlook.

This was traced to two temporary browser scripts outside the repository.

The test environment now intercepts the mailto navigation, captures the generated link and prevents Outlook from opening.

The actual Status AI Email Draft functionality remains unchanged.

A permanent `test/email-draft.test.mjs` file contains nine tests covering email subject, body, encoding, sample/live labelling and other behaviours.

No emails were sent.

## 4. Current Git State

Last pushed commit (origin/main), AI Project Health Assessment:
`b2949e5` — Improve public demo experience.

Latest state:
- Branch: `main`.
- Local main equals origin/main at 8a9db5a plus the uncommitted What Changed work. Commits so far: b2949e5, 0c48ce3, 1af18f4, then 9397f90 (tests, storage reliability, data model v2, generation metadata) and 8a9db5a (AI Project Health Assessment and mandatory status).
- Nothing has been deployed.
- `.env` and API keys remain untouched.
- No packages were installed.

Inspect the working tree again before further Git operations. Do not reset or discard existing changes. Push only with explicit approval.

## 5. Current Architecture

- React 19.
- Vite.
- Node.js and Express.
- Gemini through a server-side provider.
- Browser localStorage for project and report persistence.
- No database.
- No authentication.
- No cross-device synchronisation.

The application uses versioned browser storage under `statusai.v1` (data version 2; version 1 is migrated on load).

## 6. Product Development Priorities

The next major product phase is Project Intelligence.

Agreed sequence:

1. Improve the report data model. (DONE)
2. Implement AI Project Health Assessment. (DONE)
3. Implement What Changed. (DONE)
4. Evaluate communication integrations such as Slack and Microsoft Teams.

### AI Project Health Assessment (built)

Workflow (agreed and implemented):
1. The PM submits a project update.
2. Status AI generates the report and, in the SAME Gemini call, an internal health recommendation. There is no second AI call.
3. The PM reviews both. Nothing is pre-selected and the previous project status is not reused.
4. The PM either accepts the recommendation ("Accept recommendation (X)") or chooses a different status.
5. The PM's final status is mandatory. Save Report, Copy, Email draft and Export PDF stay disabled until it is chosen, and the store itself refuses to save a generated report without one (addReport throws). The AI recommendation alone never counts as confirmation.
6. Saving is the PM's final decision and the decision to share. There is no second approval step. The stored final status (projectStatusAtReport) is used for every later export.

Outcomes and definitions (also in the prompt):
- On Track: the project is progressing as expected, with no material threat evident.
- At Risk: an emerging issue or identified risk could affect delivery if not addressed.
- Blocked: a current unresolved impediment is preventing a critical activity or meaningful progress.
- Off Track: the project has materially deviated from agreed objectives, delivery expectations or timeline.
- Insufficient Information: a separate assessment outcome, NOT a status. It can never become a project status or a stored decision status.

Evidence rules (server/assessment.js, checked against exactly the text that was sent):
- The only sources are the submitted update, the project description and the current confirmed status. The project name, audience and reporting period are not evidence.
- Every evidence item is a quote that must appear verbatim (ignoring case, spacing and typographic quotes/dashes, minimum 8 characters) in the source it names. Unverifiable quotes are dropped and counted.
- A status needs at least one verified quote from the update, plus an explanation. Otherwise it is downgraded to Insufficient Information, with the original suggestion kept in checks.downgradedFrom. Invalid or missing AI output also becomes Insufficient Information, never On Track.
- Omission is never treated as resolution (prompt rule). The project-context snapshot remains deferred.

Data (per live report, uncommitted until approved):
- assessment: the AI recommendation exactly as shown (outcome, explanation, evidence, missingInformation, checks). Immutable, never edited.
- statusDecision: {status, action, decidedAt}. action is confirmed (PM chose the recommended status), overridden (PM chose another) or no-recommendation (the AI said Insufficient Information). status equals projectStatusAtReport.
- A changed project status goes through the existing setProjectStatus and statusHistory: source ai-confirmed when the PM accepted the recommendation, otherwise report, always naming the report. A recommendation by itself never changes any status.
- Demo reports, sample copies, migrated v1 reports and older reports have no assessment (null), and are not affected by the store guard (it applies only to addReport).

Internal vs stakeholder-facing:
- Internal only (in the app and in browser storage): recommendation, evidence, explanation, missing information, the PM decision (confirmed or overridden), model and prompt version.
- Stakeholder-facing (copy, PDF, email): ONLY the final status, as "Project Health: At Risk" (or On Track, Blocked, Off Track) directly under the project name. No "AI recommended", "Confirmed by Project Manager", "Pending review", reasoning or evidence. Older reports with no recorded status, and demo or sample reports, omit the line. Tests assert that none of the assessment text can appear in any export.

Prompt: PROMPT_VERSION is report-prompt-2026-11-08.2 (pinned by a hash test). The provider response schema requires an assessment object. The stub (test/helpers/genai-stub.mjs) supports TEST_GENAI_ASSESSMENT (omit, or a JSON assessment) so all outcomes are tested without Gemini.

Limitations: the evidence check proves a quote exists in the text, not that the conclusion is right. Sample generations and Save a Copy have no assessment. No UI lists status history yet. Exports of the assessment are intentionally unavailable.

### What Changed Since Last Report (built)

Generated automatically with every live report, in the SAME Gemini call as the report and the health assessment (no extra AI call, no separate button or screen). Shown on screen as its own section after the seven report sections, beside the internal assessment panel. It is saved with the report and included in copy, email and PDF. It is stakeholder-facing.

Heading everywhere (exact text, not upper-cased in the plain-text export): What Changed Since Last Report. It is the eighth section after the existing seven, which are unchanged. Reports without a comparison (older reports, demo reports, sample copies, sample generations) have no eighth section.

Choosing the previous report (src/history.js comparisonBaselineFor, a thin wrapper over previousReportFor so there is only one set of rules):
- same project only, ordered by reporting-period END date (never by save or generation time), strictly earlier than the new report's end date;
- demo reports and sample copies are excluded;
- the report is never compared with itself (an unsaved report has no id; a saved one is excluded by id);
- exact duplicate periods collapse to the most recent save, with a note; overlapping periods, back-dated reports and several earlier reports sharing an end date also add a plain-language note, shown in the section and exported;
- no usable period or project gives "unavailable", never a guess.
The comparison baseline is the previous report's SAVED (PM-edited) seven sections, because that is what stakeholders saw. Its original update, its AI original and its assessment are not used or sent.

How it works:
- Composer picks the baseline and sends {periodStart, periodEnd, content} as previousReport. No previous report: nothing is sent and the AI is not asked to compare; the server answers status none.
- server/comparison.js validates the previous report (shape, size limit, nothing silently truncated; invalid means unavailable) and then every AI change. The model returns changes as {category, state, text, currentQuote, previousQuote}. A change survives only if its quotes appear verbatim (case, spacing and typographic quotes ignored, minimum 8 characters) in the current update (currentQuote) or in one sentence of the previous report (previousQuote): new needs currentQuote; changed, continuing and resolved need both; unclear needs previousQuote. A continuing or resolved claim that the update does not back is downgraded to "unclear" (only in categories that allow it) or dropped, and unclear items always get fixed wording ("Previously reported: ... The current update does not confirm what has happened since."). Omission is therefore never resolution. Invented changes are dropped and counted.
- Categories: newDevelopments, completedResolved, continuingBlockers, risks, progress, nextSteps, executiveActions (empty ones are not shown). States: new, continuing, resolved, changed (shown as Update) and unclear (shown as Status unclear).
- The app combines the baseline it chose with the verified items. A comparison is 'compared' only if both exist; otherwise it is 'none' ("No previous report available for comparison.") or 'unavailable' ("A comparison with the previous report could not be completed reliably."). A compared result with no items says "No changes could be established from the submitted update."
- PM review: the PM can remove a change before saving (not edit or add). Saving stores whatsChanged (final) and generatedWhatsChanged (as the AI produced it). If the project or reporting period is changed after generating, saving is refused until the report is generated again, so a comparison always matches its report.
- Stored comparisons are validated: 'compared' requires a baseline, 'none' and 'unavailable' have no items. Earlier reports are never modified. Deleting the baseline report later does not affect a saved comparison.

AI health assessment display (src/Assessment.jsx): a collapsible section using a real button with aria-expanded and aria-controls (keyboard operable) and a chevron. On the SAVED report it is collapsed by default; the always-visible header shows "AI recommendation" and "Final assessment" side by side so a difference is obvious. "Final assessment" is the report's stored PM-finalised status (projectStatusAtReport, so it follows status edits), never the AI outcome; it reads "Not finalised" if none is recorded. The old sentences ("The project manager chose ... instead of the recommendation", "confirmed the recommendation") were removed. Opening it shows the AI recommendation with explanation, supporting evidence, missing information or concerns, and the final assessment. The DRAFT beside a freshly generated report starts OPEN (the PM is deciding there; Accept recommendation and the override guidance live inside it) and its header shows the status chosen so far. No data, generation, logic, exports, status finalisation, What Changed or Edit report behaviour changed. test/assessment-panel.test.mjs renders the real component with Vite's SSR (Vite is already a dev dependency, no new package); clicking and keyboard use are checked in the browser scripts.

Editing a saved report's Project Health (store.updateReportStatus, Edit report on the report page): the PM can change a real report's final status to one of the four statuses (invalid values throw; "Insufficient Information" can never be a status; demo reports and sample copies are refused and write nothing). It updates projectStatusAtReport and updatedAt, and the statusDecision record is recomputed against the unchanged AI recommendation (confirmed or overridden). A status-history entry is ALWAYS written {previousStatus, newStatus, at, source 'report', reportId, reportEdit: true, projectStatusChanged}. The PROJECT's own status and statusSource change only when the project's status currently comes from that report (source report or ai-confirmed with that reportId); otherwise (a newer report or a later manual decision set it) the project is left alone and the entry has projectStatusChanged false, so editing an old report cannot overwrite newer decisions. Saved comparisons whose health movement concerns the edited report (its own, and those of reports compared with it) are recalculated from the two PM-finalised statuses; nothing else in a comparison changes. Reports generated later compare with the updated saved status. The Edit report screen labels the field "Project Health" and uses the same four-status selector; the AI assessment and the What Changed items are not editable there.

Project health movement (added after the first version; deterministic, no AI): the section starts with a "Project health" line built from two PM-finalised statuses only: projectStatusAtReport of the previous (baseline) report and the status the PM finalises for this report. computeHealthMovement in src/schema.js returns moved, unchanged, previous-not-recorded (the baseline has no finalised status or no longer exists) or current-not-set (nothing is shown or exported until the PM has chosen a status). Wording is fixed: "Project Health moved from X to Y.", "Project Health is unchanged: X." or "Project Health is Y. The previous report's status was not recorded." An AI recommendation (assessment) is never used, for either report. While drafting, the line updates as the PM picks a status; on save the store recomputes it from the stored baseline report and ignores anything the caller sent (stored as whatsChanged.healthMovement, only for compared comparisons, never in generatedWhatsChanged). It cannot be removed by the PM and does not use the AI's evidence.

What stakeholders see: the change text grouped by category with New / Continuing / Resolved / Update / Status unclear markers, the period of the report it was compared with, any notes about uncertain selection, and the fallback sentences above. They never see evidence quotes, the AI health recommendation, reasoning, confidence, model or prompt details. Only the PM-finalised "Project Health: X" line carries health.

Prompt: PROMPT_VERSION is report-prompt-2026-11-09.1 (pinned by a hash test). The response schema requires a changes array only when a previous report is sent. The stub (test/helpers/genai-stub.mjs) supports TEST_GENAI_CHANGES (omit, or a JSON array) and returns changes only when the prompt contains a previous report.

Privacy: the previous report's saved text is now sent to Gemini with the generation request when one exists. Nothing extra is sent for a first report.

Limitations: quote checking proves a quote exists, not that the AI's sentence about it is right, so the PM review and the remove control matter. Only one previous report is used. Items cannot be edited. Reports saved before this feature cannot be backfilled.

## 7. Immediate Next Task

COMPLETED: (1) the data-model task (versioned storage, original/edited content, timestamps, status history, generation metadata, safe deletion), (2) the AI Project Health Assessment with mandatory status finalisation (section 6), and (3) What Changed Since Last Report (section 6, uncommitted until approved). Still on localStorage; no authentication, database or integrations. Verified by 756 tests, lint, build and the browser checks above.

NEXT: no further product feature is queued. Candidates: deployment preparation (after the Google terms review), export/import backup, a status-history screen, or Slack/Teams (blocked on server-side storage and identity decisions).

Deferred: project-context snapshot in the generation metadata; export/import backup; a UI that lists status history.

## 8. Working Rules

- Preserve all existing files and uncommitted changes.
- Do not install packages without approval.
- Do not modify `.env`, API keys or deployment configuration.
- Do not commit, push or deploy without explicit approval.
- Avoid unrelated refactoring.
- Keep implementation instructions consolidated.
- Do not repeat completed audits or engineering housekeeping unnecessarily.
- Prioritise shipping the agreed product capabilities.

## 9. Dashboard redesign (uncommitted until approved; baseline 1d4e626)

Reference: a dashboard screenshot supplied by the product owner (visual layout, colours sampled from it) and the original Status AI logo sheet.

What changed:
- Sidebar: deep plum (#3F043E, active item #71235D, both sampled from the reference) with the supplied white logo lockup, Overview / Projects / Reports with icons, and a bottom block that reads "Workspace / Personal workspace" (no accounts, so no name, job title or storage note). On mobile it is the same plum drawer; the top bar uses the full-colour logo.
- Overview header: "Overview", subtitle "A real-time view of your projects, status and recent activity.", a disabled grey "Integrations" button with a visible "Coming Soon" label (no action, aria-disabled), and "New Project", which goes to #/projects?new=1 and opens the existing create-project form (ProjectsPage openNew; closing it drops the query).
- Four summary cards (Total Projects, On Track, At Risk, Blocked) with the reference's pastel backgrounds and icon discs. Figures come from project.status via statusCounts(); a project with no status is "Not set", never On Track.
- Project Health: SVG donut (no chart library), total in the centre, legend with count and percentage. On Track, At Risk and Blocked always appear; Off Track and Not set appear only when present so the chart sums to the total. Zero projects: grey ring, "0 Projects", a message. Percentages are rounded; arcs use the exact fraction.
- Recent Reports (latest 5 by savedAt): title, project, relative date, and the FINAL PM-selected status (projectStatusAtReport; invalid or missing shows "Not recorded"). It never uses the AI recommendation. Rows link to the report. Demo and sample reports carry the existing Demo badge. The footer keeps the "N reports saved · live AI vs demo or sample" split and a Create new report link; the empty state keeps "Try a Sample Generation".
- Recent Activity (latest 5): built by activityEvents() only from recorded data: New project created (non-demo), New report generated (live AI reports), Sample copy saved, Project status updated (status-history entries that are not report edits), Saved report edited (report updatedAt, or a status-history report edit, shown once with its Project Health movement). Demo records and their fictional status history are never listed. There is no record of deletions, demo loading, or integrations, so none are shown, and nothing about Slack or syncing ever appears.
- "Projects requiring attention" and the Overview's "Create New Report" button were not in the reference. The attention list is kept as a small card below Recent Activity (shown only when there are such projects); report creation is reachable from the Recent Reports footer and empty state, the Reports page and each project.
- Tokens: page background #FBF7FC, borders #EFE8F3 on dashboard cards. Layout breakpoints: sidebar visible from 900px (264px, 288px from 1180px), four summary cards from 1100px, two-column cards from 900px; below that everything stacks and the drawer is used.

Logo handling: design/status-ai-logo-sheet.png is the original sheet, unmodified. scripts/build-logo-assets.mjs (Node built-ins only) crops public/logo-on-light.png, public/logo-on-dark.png and public/favicon.png from it. The sheet is an almost-transparent RGBA image, so the crops keep their original pixels; the white sidebar lockup comes from the sheet's plum tile with only the flat plum background converted to transparency (alpha extraction, colours unchanged), so it sits directly on the sidebar. index.html now points to /favicon.png. public/favicon.svg, status-ai-logo.svg and status-ai-logo-dark.svg (the earlier hand-drawn approximation) were deleted.

Tests: test/dashboard.test.mjs (pure logic: counts, donut segments, recent reports, activity events, relative times), test/dashboard-render.test.mjs (renders the real Overview with Vite SSR from seeded data: header, disabled Integrations, empty and populated states, final status vs AI recommendation, activity, demo handling, logo files). The store hooks gained a server-render snapshot argument (no behaviour change in the browser). Browser script dash-check.mjs (scratchpad, not in the repo) covers navigation, New Project, live updates, logo bytes, favicon, desktop/tablet/mobile layouts, drawer, a live-report flow and a saved-report status edit.

Visual refinement ROLLED BACK (by request): a "full-width, scale-with-the-screen" refinement was tried and reverted because the page looked too stretched. The layout is the earlier compact one: workspace centred and capped at 1280px, 264px sidebar (288px from 1180px), fixed px sizing, five recent reports and five activity events. Kept from that pass, on purpose: (1) the updated summary-card icons (pale circle behind each icon; purple layers glyph on pale lavender, green disc with a white check inside a pale green circle, amber warning triangle on pale amber, red disc with a white cross inside a pale pink circle, sized from the circle so they fit the compact cards), (2) the sidebar profile text "Workspace / Personal workspace", and (3) a logo 2px smaller than before (48px tall on desktop, 44px in the mobile drawer; the artwork files are unchanged).

Limitations: the reference's user profile ("Amina Okeleye / Product Manager") is not reproduced because the app has no accounts and must not show a name it does not know. The Integrations area is a placeholder only. Activity covers only the last edit of a report (updatedAt keeps one value).

## 10. Responsive design requirement (permanent, set 2026-11-09)

This applies to every future task. Treat it like the working rules in section 8.

Responsiveness is a mandatory acceptance criterion for EVERY change to Status AI: every new feature, page, form, card, chart, navigation element, modal and refinement, and every existing component that is modified. Desktop is not designed first with mobile added later.

Every change must be checked, in a real browser, at these sizes: iPhone SE (375 x 667), a larger phone (390 x 844), a tablet (768 x 1024), a small laptop / tablet landscape (1024 x 768), a 12.5-inch laptop at 100% zoom (about 1280 x 650), a laptop at 90% zoom (about 1422 x 722), 1440 x 900, 1536 x 1024 and a wide desktop (1920 x 1080).

Rules:
- Use fluid sizing, sensible breakpoints and content that reflows. Prefer CSS container queries for cards and panels (they adapt to the width they actually get, whatever the screen, sidebar or zoom), and screen-width media queries for the sidebar and drawer.
- Prevent horizontal page overflow, clipped or hidden content, overlapping elements, broken text wrapping, unreadable labels, inaccessible buttons, cards squeezed disproportionately, charts wider than their container, and unusable navigation.
- Keep the visual identity and design quality at every size. Do not just scale the desktop layout down, and do not hide data to make it fit.
- Do not stack or reorder things earlier than the width requires (for example the Overview header keeps both actions beside the heading until the container is genuinely narrow).

How to check: `npm run build`, then `npm run check:responsive`. It opens the built app in headless Edge or Chrome (set BROWSER_PATH if it is not found), loads sample data with deliberately long names, and checks every page at every size above for horizontal overflow, content past the screen edge, clipped text, tiny controls, the phone menu, and the Overview's header, summary cards, Project Health legend and report rows. Add `-- --shots <folder>` to save screenshots, and `-- --viewport 1366x650` to try another size. Add every new page to the PAGES list in scripts/responsive-check.mjs. The tool must pass, and the screenshots must be looked at, before any UI change is considered done. Passing unit tests alone is not enough.

Responsive work done on the Overview dashboard (uncommitted until approved). Root causes found by measuring the real page: (1) the header was a wrapping flex row whose actions (about 430px) plus a one-line subtitle (about 435px) did not fit beside each other below roughly 1250px, so New Project dropped under the heading; (2) Project Health switched to donut-beside-legend by SCREEN width, but the card's own width depends on the sidebar, the page padding and the zoom, so at about 1280px the 190px donut left the legend about 150px and "On Track", "Blocked" and "Off Track" wrapped; (3) summary cards switched to four across by screen width, which squeezed labels; (4) on phones the cards kept an icon-beside-figure layout that wrapped labels into three lines, the report rows were stacked three lines tall, the timeline line was one absolutely positioned bar that ran past wrapped items, and the drawer took 84% of a 375px screen.
Fixes: the dashboard, the Project Health card and the Recent Reports card are now CSS containers (container queries), so each lays itself out by the width it really has. Header: heading takes the free space (flex 1 1 0, min-width 0), the two actions are one nowrap group at the far right, and the header only stacks (actions sharing one row) when the dashboard is narrower than 560px. Below about 980px of dashboard width Integrations shows its "Coming Soon" label under the word instead of beside it, so both actions still fit. Summary cards: four across (icon beside the figure) from 840px of dashboard width, four across with the icon above the figure from 600px, two across with the icon beside the figure from 420px, and two across with the icon above the figure below that; the updated icons are unchanged. Project Health: the donut is sized from its card (--dn: clamp(120px, 100cqw - 224px, 190px)) beside a legend that never wraps (nowrap rows, values right-aligned with tabular numbers); it stacks, centred, with the legend underneath only when the card is under 344px. Recent Reports: three arrangements by card width (narrow: title up to two lines, project, then date and status; medium: title and status, project and date; wide: one line each); title, project, date and status are separate grid items so they cannot overlap. Recent Activity: each item draws its own piece of the timeline, so wrapped text never breaks it. Sidebar: 240px from 900px, 264px from 1100px, 288px from 1180px (the approved desktop sizes are unchanged); the phone drawer is at most 272px and 80% of the screen. The approved compact desktop composition, the logo size, the icons and "Workspace / Personal workspace" are unchanged.
Verified with scripts/responsive-check.mjs at ten sizes and six pages (Overview, Projects, a project workspace, Reports, a report, New report): it fails on the previous stylesheet (header drops under the heading at 768-1280px, Project Health labels wrap at 1280px) and passes on the new one. test/responsive-css.test.mjs guards the key rules.
Limitations: the tool emulates screen sizes (and 90% zoom as a larger width); it does not use a real device. Container queries need a current browser (Chrome/Edge 105+, Safari 16+, Firefox 110+); older browsers fall back to the stacked layout. Only the Overview was redesigned in this task; the other pages passed the automated checks but were not restyled.

## 11. Project Health sizing and demo Recent Activity (uncommitted until approved)

Project Health card: the donut is about 25% larger (visible ring 166px to 208px at 1536px; svg 190px to 238px) beside Recent Reports, and is centred with its legend both ways. The two cards share one row and must keep EXACTLY the height they had, so the chart area is a size container whose MINIMUM height is the height its content always needed (the old donut size or the legend rows, whichever was taller; --rows comes from the markup, legend rows have a fixed 23.25px line height); the donut then grows into whatever extra height Recent Reports gives the row (--dn: clamp(120px, min(100cqh, 100cqw - 200px), 238px)). In a single column, in a narrow card, and on phones and tablets nothing changed (max 190px). Verified by measuring both cards in 30 scenarios (five, three, one and no reports, no projects, the demo workspace, at 1280, 1366, 1440, 1536 and 1920px) before and after: identical heights, identical top and bottom alignment. scripts/responsive-check.mjs now also asserts equal heights, that the donut and legend stay inside the card and centred together, and checks the Overview with the demo workspace loaded.

Demo Recent Activity: Load Demo Workspace adds seven sample entries (state.demoActivity, demo: true, ids demo-a-01...). Each is {id, kind, at, projectId, reportId, status, demo}; kinds are project-created, project-updated, status-updated, report-generated, report-saved, report-edited. Their words are worked out from the real demo project/report each points at (names, titles), and an entry whose project or report no longer exists is skipped. The six newest cover all six kinds. They are added once (fixed ids, loadDemo is idempotent), saved with the other data, validated on load (invalid or duplicate entries are dropped and the original is set aside with a notice), and removed by Reset Demo Workspace (the confirmation says so). The key only exists in saved data once demo activity exists, so every other stored shape is unchanged. Real activity is never stored: it is derived from real records, and demo records still produce none. The dashboard shows a Demo badge on every sample entry and the Recent Activity card now shows six entries.
New REAL events added so the demo shows only kinds the product genuinely records: "Project details updated" (updateProject now sets project.updatedAt, only when a detail really changed) and "Report saved" (a live report whose generation time is known now gives two events, "New report generated" at generatedAt and "Report saved" at savedAt; older reports without a generation time stay a single event). Icons: saved report = green document, details updated = blue pencil.

Known issue (from the earlier responsive pass, NOT changed here because the Recent Reports card must keep its height): on wide cards a long report title with a Demo badge puts the badge on its own line, which makes demo report rows taller. Fix when approved: .rr-title{flex-wrap:nowrap} inside the two @container recent rules.
Tests: test/demo-activity.test.mjs (23 tests), additions to test/responsive-css.test.mjs, updated dashboard-render tests. Browser scripts (scratchpad, not in the repo): demoact-check.mjs (30 checks: demo build, six types, Demo labels, newest first, links, no duplicates after repeated clicks, reload, reset keeps real activity, real activity still works after).

## 12. FRESH-CONVERSATION HANDOVER (authoritative; written at the end of the 2026-11-08 session)

Read this section first. Where it disagrees with sections 1-11 (for example the "Current Git State" in section 4, or "Immediate Next Task" in section 7), THIS section is correct. Nothing in sections 1-11 was removed.

### 12.1 Git state (verified at the end of the session)
- Branch: main. HEAD = origin/main = 1d4e626 "feat: improve report editing and health assessment UX" (0 commits ahead, 0 behind). No stash.
- Pushed commits, oldest first: 1af18f4, 0c48ce3, b2949e5 (MVP, hardening, demo experience), 9397f90 (tests, storage reliability, data model v2, generation metadata), 8a9db5a (AI Project Health Assessment and mandatory status finalisation), 0b3c094 (What Changed Since Last Report and project health movement), 1d4e626 (editing a saved report's Project Health, collapsible AI assessment, "Final assessment" wording).
- EVERYTHING described in 12.3 to 12.6 is UNCOMMITTED in the working tree (15 tracked files modified or deleted, 11 untracked paths; lists in 12.12). NOTHING since 1d4e626 has been committed, pushed or deployed. Render has never been deployed. The user has not yet given visual approval to the dashboard work and has not approved a commit.
- Commits need the trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>", exact messages from the user, files staged by name (never git add .), and the user's explicit approval for each commit and each push.

### 12.2 Product and architecture (current)
- Status AI: AI-assisted project reporting. A PM pastes a rough update and gets a seven-section executive report PLUS (same single Gemini call) an internal AI health assessment and, when a previous report exists, a "What Changed Since Last Report" comparison (eighth section). The PM must finalise a project health status before saving. Not a project-management tool.
- Stack: React 19 + Vite, Express 5, @google/genai, jsPDF, localStorage (key statusai.v1, data version 2, optional keys statusHistory and, since this session, demoActivity). Node >= 22.12 (runs on 26). Hash router (src/router.js). No accounts, no database. Live Gemini generation is OFF in production unless LIVE_GENERATION_ENABLED=true and must stay off until the user has reviewed Google's terms. .env, GEMINI_* settings, deployment config and credentials must never be touched or printed. All tests and browser checks use a Gemini stub (test/helpers/genai-stub.mjs): no real Gemini call has ever been made by the tests.
- Server: server/index.js (POST /api/report, validation, limits, security headers), server/prompt.js (PROMPT_VERSION report-prompt-2026-11-09.1, pinned by a hash test), server/assessment.js (verbatim-evidence checks on the AI assessment), server/comparison.js (validates the previous report and the AI's proposed changes), server/providers/gemini.js (schema; "changes" only when a previous report is sent).
- Client data layer: src/store.js (state, all actions), src/schema.js (versioning, validators, migration, computeHealthMovement, decisionAction, validDemoActivity), src/history.js (previousReportFor, comparisonBaselineFor, historyFor, statusHistoryFor, reportRefState), src/sections.js (seven sections, eighth section view/text, metaLines), src/exporters.js (copy, email, PDF meta; strips evidence; demo/sample reports get no health line or comparison), src/pdf.js, src/demo.js (fictional demo workspace + demo activity), src/dashboard.js (pure dashboard logic).
- Client UI: src/App.jsx (shell, sidebar, drawer), src/Overview.jsx (dashboard), src/Composer.jsx (generate and save flow), src/Reports.jsx (library, report view, edit incl. Project Health), src/Assessment.jsx (collapsible AI assessment), src/WhatsChanged.jsx, src/Projects.jsx, src/Logo.jsx, src/icons.jsx, src/ui.jsx, src/index.css.

### 12.3 Completed this session, UNCOMMITTED: dashboard redesign, logo and responsiveness
- Overview rebuilt from the user's reference screenshot: deep-plum sidebar (#3F043E, active item #71235D), header (Overview, subtitle "A real-time view of your projects, status and recent activity.", a disabled grey "Integrations" button labelled Coming Soon with no action, and "New Project" which opens the existing create form via #/projects?new=1), four summary cards, Project Health donut and Recent Reports side by side, Recent Activity full width below, plus the kept "Projects requiring attention" card and the "saved in this browser" notes. Figures come from dashboard.js (statusCounts, healthSegments, recentReports, activityEvents, relativeTime); nothing is hardcoded; a project with no status is "Not set", never On Track. The donut always lists On Track, At Risk, Blocked and adds Off Track and Not set only when present. Recent Reports shows the latest five with the FINAL PM-selected status (projectStatusAtReport), never the AI recommendation.
- Summary-card icons (user-approved, keep): pale circle behind each icon; purple layers glyph on pale lavender; green disc with white check inside a pale green circle; amber warning triangle on pale amber; red disc with white cross inside a pale pink circle.
- Logo: the user's supplied original logo sheet is stored unmodified at design/status-ai-logo-sheet.png. scripts/build-logo-assets.mjs (Node built-ins only) crops public/logo-on-light.png, public/logo-on-dark.png (the white lockup with only the flat plum background made transparent) and public/favicon.png from it. Logo.jsx shows them. The sidebar logo is 48px tall on desktop (44px in the phone drawer): the user asked for "about 2px smaller" than the earlier 50px/46px. The old hand-drawn SVG logos were deleted.
- Sidebar bottom block reads exactly "Workspace" / "Personal workspace" (no name, job title, "Local workspace" or storage note; no accounts).
- A "full-width, scale-with-the-screen" refinement was tried and REJECTED by the user ("too stretched"); it was rolled back to the earlier compact layout (workspace centred, max 1280px, 264px sidebar and 288px from 1180px, fixed px sizing, five recent reports). Never reintroduce the stretched layout. Kept from it: the updated icons, the profile text, the 2px smaller logo.
- Responsive rebuild (this is the permanent requirement in section 10): the dashboard (.dash), Project Health card (.health) and Recent Reports card (.recent) are CSS container-query containers, so each lays itself out by the width it really has. Header: heading takes the free space, the two actions are one nowrap group at the far right (New Project rightmost), stacking only below 560px of dashboard width, with "Coming Soon" under the word "Integrations" below about 980px. Summary cards: 4 across beside-icon from 840px, 4 across icon-above from 600px, 2 across beside-icon from 420px, 2 across icon-above below that. Middle row two columns from 740px. Project Health: legend rows never wrap, donut shrinks first and stacks centred only under 344px. Recent Reports: three arrangements by card width (narrow: title up to two lines then date and status; medium: title and status, project and date; wide: one line). Recent Activity: each item draws its own piece of the timeline line. Sidebar 240px from 900px, 264px from 1100px, 288px from 1180px; phone drawer at most 272px / 80% of the screen.
- npm run check:responsive (scripts/responsive-check.mjs): opens the built app in headless Edge/Chrome (BROWSER_PATH if not found), seeds long-named sample data, and checks 7 pages (Overview, Projects, a project workspace, Reports, a report, New report, Overview with the demo workspace loaded) at 10 sizes: 375x667, 390x844, 768x1024, 1024x768, 1280x650 (12.5-inch laptop), 1366x657, 1422x722 (90% zoom), 1440x900, 1536x1024, 1920x1080; options --shots <folder> and --viewport WxH. It checks horizontal overflow, content past the edge, clipped text, tiny controls, the phone menu, header actions on one row with New Project rightmost, Integrations disabled, legend labels on one line, summary cards not squeezed, donut inside its card, report rows not overlapping, activity not clipped, and that Project Health and Recent Reports have identical height. It was proven to FAIL on the old stylesheet and on a deliberately broken card height. test/responsive-css.test.mjs guards the key rules. The user's permanent rule: every UI change is checked at these sizes in a real browser, not only by unit tests; add every new page to the PAGES list in the script.

### 12.4 Completed this session, UNCOMMITTED: Project Health donut refinement and equal-height cards
- Donut is about 25% larger beside Recent Reports (svg 190px to 238px; visible ring about 166px to 208px at 1536px wide; 233px svg at 1440px), centred with its legend both ways.
- Hard constraint from the user: Project Health and Recent Reports share one row and must keep EXACTLY their previous height and top/bottom alignment. Mechanism: in the side-by-side desktop layout the chart area (.health-body) is a size container whose MINIMUM height equals what its content always needed (max of the old donut size clamp(120px, 100cqw - 224px, 190px) and the legend rows: --rows is set by Overview.jsx, legend rows have line-height 23.25px and 12px gaps); the donut then grows into spare height only: --dn: clamp(120px, min(100cqh, 100cqw - 200px), 238px). In a single column, a narrow card, phones and tablets nothing changed (max 190px). Verified by measuring both cards in 30 scenarios (five, three, one and no reports, no projects, the demo workspace; at 1280, 1366, 1440, 1536, 1920px) before and after: identical heights and alignment, zero differences. In short rows (one or no reports) the donut stays 190px because there is no spare height. Colours, labels, percentages and counts were not touched.

### 12.5 Completed this session, UNCOMMITTED: demo Recent Activity
- "Load Demo Workspace" (the user calls it Build Demo Data) now also adds seven sample activity entries to state.demoActivity: {id demo-a-01.., kind, at, projectId, reportId, status, demo: true}; kinds project-created, project-updated, status-updated, report-generated, report-saved, report-edited. They reference real demo projects/reports (built in demo.js buildDemoActivity, times relative to now, newest first; the six newest cover all six kinds; generated just before saved). Their wording comes from the referenced records and an entry is skipped if its project or report no longer exists. Added once (fixed ids, loadDemo is idempotent), validated on load (invalid or duplicate entries dropped, original set aside, notice counts demoActivity), removed by Reset Demo Workspace (the confirm text says so). The stored shape only gains demoActivity once it exists, so all other shapes and tests are unchanged. The Overview shows six entries, each with a "Demo" badge.
- Real activity is never stored; it is derived from real records (dashboard.js activityEvents). Demo records still produce none. Two genuinely new real event kinds were added so the demo shows only things the product records: "Project details updated" (store.updateProject now sets project.updatedAt only when a detail actually changed) and "Report saved" (a live report with a known generation time now gives "New report generated" at generatedAt and "Report saved" at savedAt; reports with no generation time stay one event). Icons: saved = green document, details = blue pencil. No Slack, integration or sync events exist anywhere.
- Browser scripts (scratchpad, not in the repo): demoact-check 30/30 (six types, Demo labels, newest first, links, no duplicates after repeated clicks, reload, reset keeps real activity, real activity still works after). Tests: test/demo-activity.test.mjs (23).

### 12.6 Report-comparison investigation (read-only; NO fix made)
Trigger: the user reported that a second saved report displayed "No previous report available for comparison" although the first report was saved. The requirement text for the investigation never reached the assistant, so nothing was investigated until the end of the session. Findings from a read-only reproduction (scratchpad repro-baseline.mjs, real store, first report saved for 2026-11-01..2026-11-07, source ai, status On Track):
- Second report LATER period (8-14 Nov): found, previous = first report. Overlapping later period (5-12 Nov): found, with an overlap note.
- Second report SAME period, same end date with a different start, EARLIER (back-dated) period, a DIFFERENT project, or no period: "none" (no-earlier-report) or "unavailable" (no-usable-period).
- Cause: by the rules agreed in the What Changed task, the previous report is the saved report of the SAME project with a strictly EARLIER reporting-period END date (src/history.js previousReportFor / comparisonBaselineFor, used in Composer.jsx at generate time and re-computed by store.addReport for health movement). A second report with the same dates is therefore not "later" and gets "none". The most likely explanation of the user's observation is reusing the same reporting dates. It is by design, but the message gives no reason, so it looks like a bug. The user's exact case (dates and project) is UNCONFIRMED; ask for it if it recurs after the duplicate guard exists.
- Test coverage today: baseline selection with real store data (test/whats-changed-report.test.mjs "a saved report becomes the baseline for the next one"), first report none, duplicate periods, overlap, back-dated, no self-comparison, same period returns none (test/comparison.test.mjs). NOT covered: an end-to-end test that saves a first report and then generates a second (unit or browser), and the message a user sees when the cause is a same or earlier period. Browser scripts always SEEDED the previous report into storage, so the "save first report through the UI, then generate a second" path has never been exercised in a browser.

### 12.7 Existing report-comparison rules and files (keep consistent)
- Previous report = same project, not demo, not a sample copy, usable period (valid ISO days, start <= end), ordered by period END, strictly earlier than the new report's end, never the report itself. Exact duplicate periods among EARLIER reports collapse to the most recent save (note shown); overlapping previous period, back-dated target, several earlier reports sharing an end date all add plain-language notes (stakeholder-visible in the section and exports). No usable period or project gives "unavailable".
- Baseline used for comparison = the previous report's SAVED (PM-edited) seven sections plus its period; its original update, AI original and assessment are not used or sent. Sent to Gemini only inside the one generation request (privacy note in the README).
- Server (server/comparison.js): validatePrevious (shape, size limit 15000 chars, nothing silently truncated); validateComparison keeps a change only if its quotes appear verbatim (case, spacing, typographic quotes ignored, min 8 chars) in the CURRENT update (currentQuote) or in one sentence of the previous report (previousQuote): new needs currentQuote; changed, continuing and resolved need both; unclear needs previousQuote; a continuing or resolved claim without current support is downgraded to "unclear" (fixed wording, only in categories that allow it) or dropped, so omission is never resolution. Categories: newDevelopments, completedResolved, continuingBlockers, risks, progress, nextSteps, executiveActions. States: new, continuing, resolved, changed (shown "Update"), unclear ("Status unclear").
- Client: Composer.jsx buildWhatsChanged combines the baseline it chose with the verified items; statuses none ("No previous report available for comparison."), compared, unavailable ("A comparison with the previous report could not be completed reliably."); PM can remove items before saving (not edit); store.addReport stores whatsChanged and generatedWhatsChanged and computes healthMovement itself from the baseline report's projectStatusAtReport and the status finalised now (never an AI recommendation); store.updateReportStatus recalculates movements of the edited report and of reports compared with it. Saving is refused if the project or period changed after generating.
- Display: src/WhatsChanged.jsx (draft and saved report), src/sections.js (whatsChangedView, reportToText, stakeholderChanges), src/pdf.js, src/exporters.js. The heading is exactly "What Changed Since Last Report" and is the eighth section; evidence quotes and all assessment details are never exported; only the PM-finalised "Project Health: X" line carries health. Demo reports and sample copies get no comparison section and no health line in exports (Reports.jsx line ~156 `!report.demo`, exporters.js metaOf).
- Tests: test/comparison.test.mjs, test/whats-changed-report.test.mjs, test/health-movement.test.mjs, test/edit-report-status.test.mjs, test/report-history.test.mjs. Browser (scratchpad): changes-check 49, edit-check 33.

### 12.8 NEW PRODUCT DECISION (not implemented yet): one active saved report per project per identical reporting period
- Rule: a project may have only ONE active saved report for an identical reporting period, where "identical" means the same project ID, the same period start date and the same period end date (real reports only; demo reports and sample copies are excluded from the rule).
- Agreed behaviour: check BEFORE generation and again BEFORE saving. When an active saved report for that project and exact period exists, tell the PM clearly, and let them EDIT the existing report or DELETE it (then continue); never silently overwrite or create a duplicate. Checking before generation also avoids wasting an AI call.
- Design notes for the implementer (proposals, confirm unclear points with the user): a pure helper in src/history.js such as findReportForPeriod(state, {projectId, periodStart, periodEnd}) returning the existing eligible report; enforce in the store (addReport throws a typed error when a duplicate exists, like the existing final-status guard) AND in Composer at Generate and at Save (the save-time check covers a period changed after generating, another tab, and a report saved meanwhile); the message links to "#/reports/<id>" and "#/reports/<id>?edit=1", offers Delete via the existing ConfirmDialog, then lets the PM carry on. Edit report keeps periods immutable, so editing cannot create a collision. Existing saved data may already contain duplicates: leave them untouched, keep the existing duplicate-period handling in previousReportFor for them, and do not auto-delete. Interaction with the comparison: for new data this removes the "same period" case; the remaining "No previous report" reasons are first report, an earlier (back-dated) period, or another project; consider a PM-only hint explaining which one (the exact sentence "No previous report available for comparison." must stay the stakeholder-facing text). The same-period behaviour in 12.6 therefore becomes a guard message rather than a silent "none". Tests needed: unit (helper, store guard incl. demo/sample exclusion, different project/period allowed, delete then save allowed), render, and browser: save a first report through the UI, generate a second with the same period (blocked before generation, no AI request), with a later period (compared), after deleting the first (allowed).

### 12.9 Requirement status
- Implemented and verified (uncommitted unless noted): dashboard redesign, logo, sidebar identity, responsive layout and the check tool, Project Health donut growth with equal heights, demo Recent Activity with cleanup and no duplicates, new real activity events, everything in sections 4 and 6 that is committed (assessment, mandatory final status, What Changed, health movement, editing report status, collapsible assessment).
- Partially implemented: regression tests for the second-report comparison scenario (unit coverage exists, no end-to-end or UI-message test); browser coverage of comparisons (always with a seeded previous report); the comparison investigation (reproduced and explained, not fixed, user's exact case unconfirmed).
- Not implemented: duplicate-period guard (12.8); the outstanding demo requirements (12.10); a status-history screen; export/import backup; project-context snapshot in generation metadata; Slack/Teams; deployment to Render (needs the Google terms review first); fixing the Recent Reports "DEMO" badge wrap (12.13).

### 12.10 OUTSTANDING demo requirements (user's requirement, none implemented)
"Build Demo Data" (the Load Demo Workspace button) should showcase the intelligence features, because today demo reports are plain: no assessments, no comparisons, no movement (verified: 13 demo reports in 9 projects; 1-2 reports per project; zero have assessment, statusDecision, whatsChanged or healthMovement; the UI and exports hide the comparison section for demo reports).
- Four showcase demo projects (the ones with 2 reports today are demo-p-01, 02, 03 and 06) each with SEQUENTIAL reports (at least two, ideally three, with ascending non-overlapping periods) so each later report has a real baseline.
- Each showcase report: an AI Project Health Assessment (assessment: outcome, explanation, evidence quotes that are VERBATIM from that report's own demo update text, missingInformation, checks) and the PM's final assessment (projectStatusAtReport and statusDecision {status, action, decidedAt}); include BOTH accepted recommendations (action confirmed) and overridden ones (action overridden), and ideally one Insufficient Information (no-recommendation).
- Each later report: a realistic What Changed Since Last Report (whatsChanged: status compared, baseline {reportId of the earlier demo report, periodStart, periodEnd}, items with category/state/text/evidence quoting the current update and previous report as the server rules require, and generatedWhatsChanged) and a deterministic healthMovement computed with computeHealthMovement(previous report's projectStatusAtReport, this report's projectStatusAtReport) (moved, unchanged); the first report of each showcase project shows "No previous report available for comparison.".
- Things to decide or handle: demo reports are fictional and flagged demo:true with generatedAt null and generation provenance "not-applicable"; the UI currently hides What Changed for demo reports (Reports.jsx) and exports null it (exporters.js metaOf), so decide how to show demo comparisons (illustrative label) and whether demo reports export them; the AssessmentPanel already renders when report.assessment exists; content must stay clearly fictional and illustrative, never presented as live AI output; loadDemo only adds records whose id is missing, so demo data already in a user's browser will NOT gain the new fields unless loadDemo upserts or the user resets the demo first (decide: upsert demo records, or migration, or document "Reset then Load"); the stored data validators (validReportV2, cleanWhatsChanged) already accept these fields; baseline reportIds must point at earlier demo reports, and demo status history and projects' current status must stay consistent with the reports' final statuses; the dashboard Recent Reports and Recent Activity must still read correctly; responsive check and a browser run through the real Load Demo Workspace button are required; Reset must still remove everything.

### 12.11 Verification state (actual, run at the end of this session)
- npm test: 794 tests, 156 suites, 794 pass, 0 fail, 0 skipped, 0 todo. npm run lint: clean. npm run build: passes.
- Browser scripts (scratchpad, headless Edge, Gemini stub, last runs this session): dashboard 70/70, demo activity 30/30, generation/migration/deletion 41/41, assessment 51/51, What Changed 49/49, edit report status 33/33. npm run check:responsive: no problems across 10 sizes x 7 pages (last full run earlier in the session; not re-run after the final documentation edits, which changed no code). Card-height comparison: 30 scenarios, 0 differences.
- Outstanding failures: none known. The scratchpad browser scripts are NOT in the repository and will be lost with the session; recreate from the descriptions here or move useful ones into scripts/ (the repo already has scripts/responsive-check.mjs as the pattern: Node built-ins, DevTools protocol, no packages). Email draft must never be clicked in a browser test without an interceptor (it opens Outlook).

### 12.12 Files changed since 1d4e626 (all uncommitted)
- Modified (12): README.md, STATUS_AI_HANDOVER.md, index.html (favicon.png), package.json (adds only the "check:responsive" script), src/App.jsx (Workspace identity, drawer, nav icons, ?new=1, notice counts), src/Logo.jsx (supplied artwork), src/Overview.jsx, src/Projects.jsx (openNew, reset message), src/demo.js (buildDemoActivity), src/index.css, src/schema.js (validDemoActivity), src/store.js (updateProject.updatedAt, demoActivity load/loadDemo/resetDemo, server-render snapshots for hooks).
- Deleted (3): public/favicon.svg, public/status-ai-logo.svg, public/status-ai-logo-dark.svg (the earlier hand-drawn logo).
- New (11 paths): design/status-ai-logo-sheet.png, public/favicon.png, public/logo-on-dark.png, public/logo-on-light.png, scripts/build-logo-assets.mjs, scripts/responsive-check.mjs, src/dashboard.js, src/icons.jsx, test/dashboard.test.mjs, test/dashboard-render.test.mjs, test/demo-activity.test.mjs, test/responsive-css.test.mjs. (test/dashboard-render.test.mjs and test/responsive-css.test.mjs render components with Vite's SSR; Vite is already a dev dependency; no new packages were installed anywhere.)
- Not changed this session: server/*, .env, credentials, Gemini and deployment settings.

### 12.13 Known limitations and issues
- Recent Reports DEMO badge: on wide cards a long report title with the Demo badge puts the badge on its own line (introduced by the responsive pass: .rr-title has flex-wrap:wrap), making demo rows taller. NOT fixed because the user said the Recent Reports card height must not change. One-line fix when approved: add flex-wrap:nowrap to .rr-title inside the two @container recent rules.
- With five long report titles the Project Health card is tall and the donut sits centred with blank space above and below (inherent to the equal-height rule).
- The responsive tool emulates screen sizes (90% zoom as a wider screen), not real devices; container queries need Chrome/Edge 105+, Safari 16+, Firefox 110+ (older browsers fall back to the stacked layout). Only the Overview was redesigned; other pages pass the automated checks but were not restyled.
- Activity covers only a report's last edit (updatedAt holds one value). Recent Activity "Report saved" and "New report generated" are two events only when generatedAt is known.
- Items on a comparison can be removed but not edited; quote checking proves a quote exists, not that the AI's sentence about it is right; only one previous report is used. Integrations is a placeholder.
- The earlier known gaps in section 8 still apply (multi-tab overwrites, no UI for set-aside data, no double-submit guards on Save/Create Project, duplicated section definitions in server/prompt.js and src/sections.js, no compression).

### 12.14 Precise next steps
1. Ask the user whether to review and approve the uncommitted dashboard/responsive/demo-activity work for a COMMIT now (recommended before more feature work, because the next features touch store.js, Composer.jsx, demo.js and index.css again). Suggest one commit for the dashboard work and show the staged file list first; then wait for a separate push approval.
2. Implement the duplicate-period guard (12.8): helper in src/history.js, store guard, Composer checks at Generate and at Save with Open / Edit / Delete choices, tests (unit, render, browser through the real UI with the stub), docs. Check responsiveness at every size and run npm run check:responsive.
3. Reproduce the user's original complaint end to end in a browser (save a first report through the UI, generate a second with a later period; then with the same period) and add the missing regression tests; improve the PM-facing explanation for the remaining "none" reasons without changing the stakeholder sentence.
4. Implement the demo showcase (12.10): extend src/demo.js with four showcase projects, sequential reports, assessments with verbatim evidence, accepted and overridden decisions, What Changed comparisons and deterministic health movement; decide how demo comparisons are displayed and exported; handle demo data already stored in a browser (upsert or reset); keep demo clearly fictional; update tests (test/demo.test.mjs, test/demo-activity.test.mjs, new showcase tests), run the responsive check including the demo page, and verify through the real Load Demo Workspace button in a browser.
5. After each step: npm test, npm run lint, npm run build, npm run check:responsive and the relevant browser checks, review the whole git diff, update README.md and this handover, then WAIT for the user's visual review and explicit commit approval. Do not claim any check that was not actually run.

### 12.15 Environment and working notes for the next session
- Windows 11; PowerShell and a Bash tool (Git Bash). The Bash tool mangles backslashes and some quotes inside heredocs: write scripts and regexes with the Write tool, or use String.raw in small Node scripts, then run them. The Edit tool requires a prior Read of the file. Project path has spaces (OneDrive - Omniswift Limited). Edge for browser checks is at C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe. Do not kill all browser processes (blocked, and it would affect the user's own browser).
- The user wants: honest reporting (say plainly when something was not run or not done), stakeholder-facing exports free of AI internals, sample/demo content never presented as live AI output, the approved compact desktop design preserved, and responsiveness checked on every change. The user's own name appears in their reference screenshots; never hardcode it into the product.

## 13. Duplicate-period guard (built after section 12; committed locally on top of the dashboard commit, not pushed)

Rule: a project can have only ONE saved real report for an identical period (same project id, same periodStart, same periodEnd). Different periods (including overlapping ones), other projects, demo reports and sample copies are not affected. Overlap handling in history.js is unchanged.

Where it lives (one definition, two enforcement points):
- src/history.js: findReportForPeriod(state, {projectId, periodStart, periodEnd, excludeId}) and DUPLICATE_PERIOD_MESSAGE (the exact product wording).
- src/store.js: addReport throws DuplicatePeriodError (code DUPLICATE_PERIOD, existingReportId) BEFORE changing or writing anything, using the live state at save time. Nothing is overwritten. updateReportContent and updateReportStatus never touch periods, so editing is never blocked.
- src/Composer.jsx: as soon as a project and a complete period match an existing report, it shows the message with "Open existing report" (#/reports/<id>) and "Delete existing report" (existing ConfirmDialog); Generate and Save are disabled, and generate() itself refuses, so no AI request is made. Save re-checks and also catches DuplicatePeriodError from the store. Sample generation is not blocked.
- Existing stored duplicates are left untouched (no auto-delete); comparisonBaselineFor still handles them.

Tests: test/duplicate-period.test.mjs (20). test/helpers/fixtures.mjs reportInput now moves its default period on by one week per report built for the same project (the first stays 2026-11-01..07), because the old fixture saved many reports with identical dates; two tests (health-movement, whats-changed-report) were adjusted to match. Mutation check: disabling the store guard fails 4 of the new tests.
Verified: npm test 814/814, lint clean, build passes, npm run check:responsive clean (10 sizes x 7 pages), browser check against the Gemini stub 35/35 (save first report via UI; same period blocked before generation with zero AI requests; other project and overlapping period allowed; edit existing; delete then replace; draft moved onto a taken period blocks Save; notice fits at 9 sizes). The browser script is in the session scratchpad, not the repo.
Not done: a PM-only hint explaining WHY a comparison shows "No previous report" (first report / earlier period / other project); the stakeholder sentence is unchanged.
