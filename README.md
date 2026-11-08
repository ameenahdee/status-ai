# Status AI

Status AI is an AI-powered project reporting workspace. A Project Manager pastes rough project updates and gets a structured, executive-ready status report, then edits it, saves it against a project, and exports or shares it.

Status AI is deliberately **not** a project management platform. Projects exist to organise reporting context; reporting is the product.

## Features

- **AI report generation** from unstructured updates, using Google Gemini on the server.
- **Seven-section reports**: Executive Summary, Completed Activities, Work in Progress, Blockers, Risks, Next Steps, Executive Action Required. All seven always appear; empty sections show a clear fallback rather than being omitted.
- **Honest AI behaviour**: the model is instructed to use only facts in the update, and to prefix anything it suggests (rather than something you stated) with "Suggested:".
- **Projects** with a required name, start date and description (up to 500 characters), plus optional owner and reporting audience. The description is sent to the AI as background context.
- **Project status** (On Track, At Risk, Blocked, Off Track) set by you, never invented. Where a status comes from a saved report, the source is shown.
- **AI Project Health Assessment**: when a report is generated, the same AI call also recommends a project health status (On Track, At Risk, Blocked or Off Track) or says "Insufficient Information", which is a separate outcome and not a status. The recommendation comes with supporting evidence, an explanation and any missing information, and appears beside the generated report as internal decision support. Evidence must be verbatim quotes from the submitted update, the project description or the current confirmed status; anything the server cannot find in that text is removed, and a status with no verified quote from the update is downgraded to "Insufficient Information". The AI only recommends and never changes a status.
- **The PM finalises the status before saving.** A generated report cannot be saved, copied, emailed or exported until the project manager has explicitly chosen a final status, either by accepting the recommendation or by choosing a different one. Nothing is pre-selected, the project's previous status is not reused, and the AI recommendation alone never counts. Choosing a status that differs from the project's current one is recorded in the project's status history (as "AI-confirmed" when the PM accepted the recommendation, otherwise as set from the report). The guard is enforced in the store as well as on screen.
- **Internal assessment vs stakeholder output**: the AI recommendation, evidence, explanation, the PM's decision (confirmed or overridden) and the model and prompt version are stored with the report for traceability and are never exported. Copy, PDF and email show only the final status, written as "Project Health: At Risk" (or On Track, Blocked, Off Track) under the project name. Sample and demo reports carry no health line.
- **What Changed Since Last Report**: the same generation call also compares the update with the previous valid report for the same project, and the result is saved with the report as an eighth section after the seven (never merged into them). It appears in the report on screen, the saved report, copy, email and PDF under the exact heading "What Changed Since Last Report". Changes are grouped as New developments, Completed or resolved, Continuing blockers, Changing risks, Progress, Next steps and Executive actions (empty groups are not shown), and each is marked New, Continuing, Resolved, Update or Status unclear. It also shows project health movement as its first line ("Project Health moved from At Risk to Blocked.", "Project Health is unchanged: On Track.", or a note that the previous status was not recorded), worked out by the app from the two PM-finalised statuses only (the status finalised on the previous report and the one you finalise now). An AI recommendation is never used for this, and the line appears once you have finalised a status. The previous report is chosen with the same history rules as everywhere else: same project, by reporting-period END date (not save time), never demo reports or sample copies, never the report itself, with duplicate, overlapping and back-dated periods handled and noted. Every change must quote the update (and, for continuing, resolved or changed items, the previous report) verbatim or it is removed. Something that is simply missing from the update is never called resolved; at most it is shown as "Status unclear". A first report says "No previous report available for comparison.", and if a comparison cannot be made reliably the report says so instead of inventing changes. The PM can remove a change before saving. Only the change text is exported; the evidence quotes stay with the PM.
- **Reporting periods** kept separate from the generation date, with validation that the end date is not before the start date.
- **Original updates preserved** alongside every report, and never changed when a report is edited.
- **Reports library** with All, Recent and By Project views, search, and per-report actions: open, edit, copy, export PDF, email draft, delete (with confirmation).
- **Overview** with figures calculated only from saved data.
- **Try a Sample Generation**: loads a prepared, fictional update into the normal form so you can review it, then shows a pre-written sample report for it. It makes no API call and never touches Gemini, so it works even when live generation is off.
- **Sample report previews** are editable and support copy, PDF and email, but are clearly labelled "Sample report · Illustrative output — not generated live". Sample content only says what its fictional update says; anything beyond it is marked "Suggested:".
- **Save a Copy** keeps a separate, editable copy of a sample or demo report in a demo project (the report's own project by default). The original is never changed, and saving the same sample into a project twice asks you to confirm. Copies are labelled "Sample copy" and show "Saved" rather than "Generated".
- **Illustrative vs live**: sample, demo and sample-copy reports are never presented as AI-generated. Overview reports "Reports saved" with a live-AI vs demo/sample split, and exports (copy, PDF, email) of illustrative reports are marked as samples.
- **Demo workspace**: ten fictional projects and thirteen locally written reports, loadable and resettable from the Projects page. Demo records are flagged. **Reset Demo Workspace** removes only demo records, including any sample copies you saved; projects and reports you created yourself are kept, and a demo project that holds one of your own reports is kept as a normal project.
- **Responsive**: drawer navigation on phones and tablets, persistent sidebar on desktop, motion that respects `prefers-reduced-motion`.
- No accounts or sign-in.

## Tech stack

| Area | Choice |
| --- | --- |
| Frontend | React 19, Vite |
| Backend | Node.js, Express 5 |
| AI | Google Gemini via the official `@google/genai` SDK |
| PDF export | jsPDF (loaded on demand) |
| Storage | Browser `localStorage` |
| Linting | Oxlint |

## Getting started

### Prerequisites

- Node.js 22.12 or newer, and npm
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### Install and configure

```bash
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Edit `.env` and set `GEMINI_API_KEY`. The `.env` file is ignored by Git and must never be committed.

### Run in development

```bash
npm run dev
```

This starts the Express API on port 3001 and the Vite dev server together. Open <http://localhost:5173>. Vite proxies `/api` requests to the API.

### Build and run for production

```bash
npm run build
npm start
```

`npm start` serves the built frontend and the API from one Node process (port 3001 by default, or `PORT`).

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API and Vite dev server together |
| `npm run build` | Production frontend build into `dist/` |
| `npm start` | Serve `dist/` and the API |
| `npm run lint` | Run Oxlint |
| `npm test` | Run the automated test suite once |
| `npm run test:watch` | Re-run tests when files change |
| `npm run test:coverage` | Run tests with Node's built-in coverage report (indicative only, see Testing) |

## Testing

The test suite uses Node's built-in test runner (`node:test`), so it needs **no extra packages** and runs on the Node version the project already requires.

```bash
npm test
```

Expected result: all tests pass (`fail 0`, exit code 0). A few entries are reported as **todo**: they are known gaps that are written down as tests but intentionally not enforced yet (see below). They do not fail the run.

**What is covered** (everything lives in `test/`):

| File | Covers |
| --- | --- |
| `projects.test.mjs` | Creating and editing projects, the 500-character description limit, status changes, project/report associations |
| `reports.test.mjs` | Saving, editing and deleting reports; original update, reporting period and project link preserved; history ordering |
| `demo.test.mjs` | Demo workspace data, load/reset behaviour, Save a Copy (separate deep copy, edits kept, originals unchanged, copies removed by reset), the prepared sample scenario |
| `persistence.test.mjs` | Data surviving a refresh, existing/older data loading, corrupted or unexpected stored data, storage failures |
| `sections.test.mjs` | The seven-section structure and fallbacks, edit helpers, and that sample, demo and live reports are labelled and exported differently |
| `email-draft.test.mjs` | The Email draft link (`mailto:` subject and body, encoding, sample marking), tested against a fake `window` so nothing can open |
| `schema.test.mjs`, `migration.test.mjs` | Schema validators and the version 1 → 2 migration (nothing lost or invented, idempotent, pre-migration backup, newer-version protection) |
| `report-model.test.mjs`, `status-history.test.mjs` | Original update and AI output preserved apart from edits, separate timestamps, status snapshot at report time, status history and allowed sources |
| `report-history.test.mjs` | Historical selection: same project, period-end ordering, sample exclusion, duplicate and overlapping periods, back-filled reports |
| `limits.test.mjs` | Per-IP rate limiter (with pruning) and global daily cap |
| `api.test.mjs` | `POST /api/report` and `/api/health`: validation, JSON error format, disabled live generation, provider errors and timeouts, usage limits, security headers |

**How the tests stay safe and repeatable**

- **No real Gemini calls, ever.** The API tests start the real server as a child process with a preload (`test/helpers/genai-stub.mjs`) that replaces `fetch`: Gemini answers come from a controlled stub, and any other network call is blocked.
- **No real keys or `.env`.** The test server uses a fake key and runs in an empty temporary folder, so your real `.env` is never read.
- **No real browser storage.** Store tests use an in-memory fake `localStorage`, loaded fresh for every test (`test/helpers/storage.mjs`).
- Tests are independent: each gets its own storage or server, on a free port.
- **Never click "Email draft" in a real browser test without intercepting it.** It navigates to a `mailto:` link, which opens the machine's default mail app (for example Outlook) with a prefilled draft. Browser-level switches (the Navigation API, a CSP `sandbox` header, profile settings) do not stop this. Either rely on `email-draft.test.mjs`, or, in a browser test, rewrite the single `window.location.href = \`mailto:…\`` line as the test browser loads the script (so the real handler still runs but only records the link) and check that rewrite actually happened before clicking.

**Not covered yet**

- **React components and UI flows** (form validation messages, that a sample is not saved until you choose Save a Copy, drawer navigation, modals, PDF download, responsive layout). These need a DOM or browser test tool, which is not set up.
- Project field validation (required name, start date and description) lives inside the project form component, so only the store-level limits are tested.
- `server/index.js` runs in a child process, so `npm run test:coverage` cannot see it, and it under-counts `src/store.js` because each test loads a fresh copy. Treat coverage numbers as indicative, not as a measure of completeness.

**Known gaps:** none are currently recorded as `todo`. If you find a gap you cannot fix yet, write it as a test with `{ todo: 'reason' }` (or `it.todo(...)`) so it shows up in every run without failing it, and remove the marker when it is fixed.

**Storage behaviour that is tested** (see `persistence.test.mjs`): a failed save is reported (`getPersistence()` says `ok: false`) instead of looking successful, and recovers when a later save works; if saved data cannot be read the app stops writing so it cannot overwrite it; unreadable or malformed stored data is copied to a second key (`statusai.v1.set-aside`) before the app starts afresh, and valid records load exactly as stored. How these appear on screen (the warning banner and the "NOT saved" messages) is UI behaviour and is not covered by automated tests yet.

## Configuration

All configuration is read on the server from environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | none (required) | Gemini API key. Server-side only; never sent to the browser. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Gemini model name. Model availability and capacity change over time; if generation stalls or returns 404, check which models your key can use and set this accordingly. |
| `GEMINI_TIMEOUT_MS` | `45000` | How long to wait for Gemini before returning a timeout error. |
| `AI_PROVIDER` | `gemini` | Which provider implementation to use. |
| `PORT` | `3001` | Server port. |
| `DAILY_REQUEST_CAP` | `200` | Global cap on live AI generations per UTC day, shared by all visitors, to protect the free quota. |
| `LIVE_GENERATION_ENABLED` | on outside production, **off** in production | Live generation sends visitor text to Google, so when `NODE_ENV=production` it must be switched on explicitly with `true`. When off, the API returns a clear message and the sample report and demo workspace still work. |

## Architecture

```
src/                 React app (hash-routed, no router dependency)
  App.jsx            Shell, navigation drawer, page routing
  Overview.jsx       Reporting snapshot
  Projects.jsx       Project directory, workspace, create/edit form, demo controls
  Reports.jsx        Reports library and report view
  Composer.jsx       New report flow (live generation and sample generation, mandatory final status)
  Assessment.jsx     Internal AI health assessment panel (recommendation and PM decision)
  WhatsChanged.jsx   The eighth section: What Changed Since Last Report
  SaveCopy.jsx       "Save a Copy" dialog for sample and demo reports
  store.js           localStorage-backed store and actions
  schema.js          Storage schema version, validators, migration, assessment and decision rules
  history.js         Read-only helpers for report and status history
  demo.js            Fictional demo workspace data
  samples.js         Prepared fictional sample update and its pre-written report
  sections.js        The seven-section definition and text helpers
  pdf.js, exporters.js   PDF, copy and email-draft output
server/
  index.js           Express API: POST /api/report, validation, rate limiting, errors
  limits.js          Per-IP rate limiter (with pruning) and global daily cap
  prompt.js          System prompt, section definitions and PROMPT_VERSION
  assessment.js      Checks the AI health assessment (verbatim evidence, downgrade rules)
  comparison.js      Checks the AI's What Changed items against the update and the previous report
  providers/
    index.js         Provider selection (AI_PROVIDER)
    gemini.js        Gemini implementation
```

**Replaceable AI provider.** The server talks to the model only through a provider that implements `generateReport({ updates, projectName, projectDescription, audience, periodStart, periodEnd })` and returns the report object. Adding another provider (for example one backed by retrieval over past reports) means adding a file under `server/providers/` and a case in `server/providers/index.js`. No retrieval or vector storage is implemented today.

**Data model (schema version 2).** Projects, reports and status history are stored under one `localStorage` key (`statusai.v1`, with a `version` field inside). Every record has a stable UUID; links between them use ids, never array position.

A report keeps these independently:

| Field | Meaning |
| --- | --- |
| `originalUpdate` | The text the PM submitted. Never changed. |
| `generatedContent` | The original AI output, kept after edits. Never changed. `null` when unknown or not applicable. |
| `content` | The PM-editable report (starts as a copy of the AI output). |
| `periodStart`, `periodEnd` | The reporting period. |
| `generatedAt` | When the AI really generated it (supplied by the server). `null` if unknown. |
| `savedAt` / `updatedAt` | When first saved / last edited (`null` until edited). The save time is never used as the generation time. |
| `projectStatusAtReport` | The project's confirmed status when the report was saved. Later status changes do not rewrite it. |
| `provenance` | `recorded`, `recovered`, `unknown` or `not-applicable` for `generatedAt` and `generatedContent`, so unknown is distinguishable from confirmed. |

**Status history** (`statusHistory`): each change records `projectId`, `previousStatus`, `newStatus`, `at`, `source` and the associated `reportId`. Allowed sources are `manual`, `report` and `ai-confirmed` (an AI recommendation that the PM accepted). An AI recommendation on its own is never a status change.

**Historical selection** (`src/history.js`, for the future "What Changed"; no UI yet): same project only; ordered by reporting-period end date (not save time); demo reports and saved sample copies are excluded; exact duplicate periods, overlapping periods and back-filled reports are flagged explicitly (a back-filled report is never treated as the latest); a missing item is never assumed resolved.

**Migration.** Version 1 data is migrated automatically on load. Nothing is dropped, ids and associations are kept, and nothing is invented: an old report's `generatedAt` (which was really the save time) becomes `savedAt`, the AI generation time stays `null`/`unknown`, and the original AI output is recovered only for live reports that were never edited. Before the first migration the original data is copied once to `statusai.v1.pre-v2` (never overwritten). Data saved by a newer version of the app is left untouched and not overwritten (a warning banner explains).

**API behaviour.** `POST /api/report` validates input (length limits, date format), applies a per-IP rate limit (8 requests per minute, in memory, idle entries pruned) and a global daily cap, enforces a provider timeout, and maps provider failures to friendly messages (busy, usage limit reached, timeout). Technical details and credentials are never returned to the browser.

## Data and privacy

- Projects, reports and original updates are stored **in your browser only**. They are not synchronised across devices or users, and clearing browser data removes them.
- If the browser cannot save (storage full or blocked, for example in a private window), a warning banner says so and success messages are replaced by a "NOT saved" warning. If saved data cannot be read, the app does not overwrite it. Data that cannot be loaded is set aside in a second storage key (`statusai.v1.set-aside`), not deleted.
- When you generate a report, the update text, project name, project description, audience and reporting period are sent to your server and then to the Gemini API. Do not submit confidential information you are not permitted to share with that provider.
- Demo content is entirely fictional and illustrative.
- To compare with the previous report, the saved text of that report (its seven sections, and its reporting period) is also sent to your server and then to the Gemini API in the same request. Only the previous report of the same project is sent, never its original update, the assessment, or other projects. Nothing is sent for a first report.
- The health assessment sends nothing extra: it uses the project description, the current confirmed status and the update, which are already part of the generation request.
- The assessment is stored in your browser with the report as an internal record. It is never included in copy, PDF or email output.
- AI-generated content can contain mistakes. Review before sharing.

## Deployment notes

The app builds to a single Node service. On any Node host, run `npm run build` then `npm start`, and set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) as environment variables on the host. Never place the key in the repository or the frontend. The in-memory limiters are per process; use a shared store if you run multiple instances.

The server sends basic security headers (including a Content Security Policy that allows only this origin and Google Fonts), hides the Express banner, marks API responses `no-store`, and caches hashed build assets for a year while always revalidating HTML. The HTTP `Strict-Transport-Security` header is sent only for HTTPS requests. Responses are not compressed by the app; rely on the host or CDN for that.

**Before exposing live generation publicly**, review Google's current Gemini API terms for your service tier (including age requirements and how submitted content may be used) and put an appropriate operating arrangement in place. Until then, leave `LIVE_GENERATION_ENABLED` unset in production: visitors can still use the sample report and demo workspace.

## Known limitations

- Local-only storage; no accounts, sync or collaboration.
- The health assessment is a recommendation. Its evidence check confirms that quotes really appear in your text; it does not prove that the conclusion is right. The PM owns the final status.
- What Changed checks that quotes really appear in the update and the previous report; it cannot prove that the AI's wording of a change is correct, so the PM reviews it and can remove items (but not edit them). It compares with one previous report only, and uses its saved text, so it can only be as good as that report.
- Reports saved before this feature, demo reports and sample copies have no What Changed section. If the previous report has no finalised status (for example an older report), health movement says its previous status was not recorded rather than guessing.
- Sample reports and Save a Copy do not include a health assessment, and the store-level status requirement applies only to reports generated and saved through the normal flow.
- Reports saved before the assessment feature have no assessment, and may have no recorded status; their exports simply omit the health line.
- Automated tests cover the data layer and API but not the React UI (see Testing).
- Email drafts use a `mailto:` link, so very long reports may be truncated by some email clients.
- Free-tier Gemini capacity varies and can return temporary "busy" errors.

## Project status

MVP. The scope is intentionally limited to project reporting.
