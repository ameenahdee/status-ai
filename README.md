# Status AI

Status AI is an AI-powered project reporting workspace. A Project Manager pastes rough project updates and gets a structured, executive-ready status report, then edits it, saves it against a project, and exports or shares it.

Status AI is deliberately **not** a project management platform. Projects exist to organise reporting context; reporting is the product.

## Features

- **AI report generation** from unstructured updates, using Google Gemini on the server.
- **Seven-section reports**: Executive Summary, Completed Activities, Work in Progress, Blockers, Risks, Next Steps, Executive Action Required. All seven always appear; empty sections show a clear fallback rather than being omitted.
- **Honest AI behaviour**: the model is instructed to use only facts in the update, and to prefix anything it suggests (rather than something you stated) with "Suggested:".
- **Projects** with a required name, start date and description (up to 500 characters), plus optional owner and reporting audience. The description is sent to the AI as background context.
- **Project status** (On Track, At Risk, Blocked, Off Track) set by you, never invented. Where a status comes from a saved report, the source is shown.
- **Reporting periods** kept separate from the generation date, with validation that the end date is not before the start date.
- **Original updates preserved** alongside every report, and never changed when a report is edited.
- **Reports library** with All, Recent and By Project views, search, and per-report actions: open, edit, copy, export PDF, email draft, delete (with confirmation).
- **Overview** with figures calculated only from saved data.
- **Sample report** that is a local preview: it makes no API call, is clearly labelled, and cannot be saved.
- **Demo workspace**: ten fictional projects and thirteen locally written reports, loadable and resettable from the Projects page. Demo records are flagged and reset removes only demo records.
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
  Composer.jsx       New report flow (live generation and sample preview)
  store.js           localStorage-backed store and actions
  demo.js            Fictional demo workspace data
  sections.js        The seven-section definition and text helpers
  pdf.js, exporters.js   PDF, copy and email-draft output
server/
  index.js           Express API: POST /api/report, validation, rate limiting, errors
  limits.js          Per-IP rate limiter (with pruning) and global daily cap
  prompt.js          System prompt and section definitions
  providers/
    index.js         Provider selection (AI_PROVIDER)
    gemini.js        Gemini implementation
```

**Replaceable AI provider.** The server talks to the model only through a provider that implements `generateReport({ updates, projectName, projectDescription, audience, periodStart, periodEnd })` and returns the report object. Adding another provider (for example one backed by retrieval over past reports) means adding a file under `server/providers/` and a case in `server/providers/index.js`. No retrieval or vector storage is implemented today.

**Data model.** Projects and reports are stored under one `localStorage` key (`statusai.v1`). Records have stable UUIDs, ISO timestamps, the original submitted update, and the reporting period, so they can later move to a database without reshaping.

**API behaviour.** `POST /api/report` validates input (length limits, date format), applies a per-IP rate limit (8 requests per minute, in memory, idle entries pruned) and a global daily cap, enforces a provider timeout, and maps provider failures to friendly messages (busy, usage limit reached, timeout). Technical details and credentials are never returned to the browser.

## Data and privacy

- Projects, reports and original updates are stored **in your browser only**. They are not synchronised across devices or users, and clearing browser data removes them.
- When you generate a report, the update text, project name, project description, audience and reporting period are sent to your server and then to the Gemini API. Do not submit confidential information you are not permitted to share with that provider.
- Demo content is entirely fictional and illustrative.
- AI-generated content can contain mistakes. Review before sharing.

## Deployment notes

The app builds to a single Node service. On any Node host, run `npm run build` then `npm start`, and set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`) as environment variables on the host. Never place the key in the repository or the frontend. The in-memory limiters are per process; use a shared store if you run multiple instances.

The server sends basic security headers (including a Content Security Policy that allows only this origin and Google Fonts), hides the Express banner, marks API responses `no-store`, and caches hashed build assets for a year while always revalidating HTML. The HTTP `Strict-Transport-Security` header is sent only for HTTPS requests. Responses are not compressed by the app; rely on the host or CDN for that.

**Before exposing live generation publicly**, review Google's current Gemini API terms for your service tier (including age requirements and how submitted content may be used) and put an appropriate operating arrangement in place. Until then, leave `LIVE_GENERATION_ENABLED` unset in production: visitors can still use the sample report and demo workspace.

## Known limitations

- Local-only storage; no accounts, sync or collaboration.
- No automated test suite is included yet.
- Email drafts use a `mailto:` link, so very long reports may be truncated by some email clients.
- Free-tier Gemini capacity varies and can return temporary "busy" errors.

## Project status

MVP. The scope is intentionally limited to project reporting.
