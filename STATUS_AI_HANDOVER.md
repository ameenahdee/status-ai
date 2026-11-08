Status AI: handover summary
State as of 2026-11-08. Everything below was checked against the repo just now, except where marked "from earlier rounds".

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
Overview.jsx: stat cards, status counts, recent reports, attention list.
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
Logo.jsx: ribbon-S mark.
State: store.js is a module-level singleton using useSyncExternalStore. All changes go through commit().
Design system: Plum #351044 (hover #481653, light #60216F), pink #D94C9B (light #FCE7F3), background #FAF8FB, borders #E5DFE8, text #241B29 / #756C7A, Inter font. Mobile-first CSS with breakpoints at 560, 640, 800, 900 and 1180px. It respects prefers-reduced-motion.
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
Repo suite (npm test): 713 tests (568 before What Changed), all pass, about 20s. npm run lint is clean and npm run build passes. Mutation checks on throw-away copies confirmed that the main rules are each caught by tests when broken: deletion marking, generation metadata, evidence verification, the update-evidence requirement, no default to On Track, the decision action, the Project Health export line, the demo exclusion, the store-level status guard, resolved-without-current-quote kept, current quote not checked, evidence leaking into exports, and demo reports exporting the section.
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
- 713 automated tests passing (258 when the test foundation was first built).
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

COMPLETED: (1) the data-model task (versioned storage, original/edited content, timestamps, status history, generation metadata, safe deletion), (2) the AI Project Health Assessment with mandatory status finalisation (section 6), and (3) What Changed Since Last Report (section 6, uncommitted until approved). Still on localStorage; no authentication, database or integrations. Verified by 713 tests, lint, build and the browser checks above.

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