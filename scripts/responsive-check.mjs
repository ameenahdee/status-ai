// Responsive check for Status AI (a permanent part of every UI change: see README "Responsive design requirement").
//
// Opens the BUILT app in a headless Chromium browser (Edge or Chrome, found automatically or via BROWSER_PATH),
// loads sample data, and for every screen size and page checks the things that go wrong on small and awkward
// screens: horizontal page overflow, content past the right edge, clipped text, unusable buttons, navigation, and
// the Overview dashboard's header, summary cards and Project Health legend.
//
//   npm run build && npm run check:responsive
//   npm run check:responsive -- --shots ./responsive-shots      (also saves a screenshot of every page and size)
//   npm run check:responsive -- --viewport 1366x650             (one extra size, for example your own laptop)
//
// Uses Node built-ins only. Exits with a non-zero code if anything fails. Nothing here contacts Gemini or any other
// network: the server runs without an API key, from an empty folder, so no .env is read.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const SHOTS = arg('--shots')
const EXTRA = args.flatMap((a, i) => (a === '--viewport' ? [args[i + 1]] : []))

// name, width, height, mobile emulation. 1422 x 722 is a 1280 x 650 laptop at 90% browser zoom.
const VIEWPORTS = [
  ['iPhone SE', 375, 667, true],
  ['large phone', 390, 844, true],
  ['tablet', 768, 1024, false],
  ['small laptop / tablet landscape', 1024, 768, false],
  ['12.5-inch laptop (1280)', 1280, 650, false],
  ['laptop (1366)', 1366, 657, false],
  ['laptop at 90% zoom', 1422, 722, false],
  ['desktop 1440', 1440, 900, false],
  ['desktop 1536', 1536, 1024, false],
  ['wide desktop 1920', 1920, 1080, false],
  ...EXTRA.map((v) => {
    const [w, h] = v.split('x').map(Number)
    return [`custom ${v}`, w, h, w < 600]
  }),
]

// ---------- sample data (long names on purpose: they are what breaks layouts) ----------
const now = Date.now()
const iso = (ago) => new Date(now - ago).toISOString()
const H = 3_600_000
const D = 24 * H
const body = (title) => ({ title, executiveSummary: 'Summary of the period.', completedActivities: ['Finished the login API'], workInProgress: ['Dashboard build'], blockers: ['Waiting on vendor credentials'], risks: ['Go-live may slip'], nextSteps: ['Start user acceptance testing'], executiveActionRequired: ['No executive action required at this time.'] })
const project = (id, name, status, created, set) => ({ id, name, startDate: '2026-01-01', description: `${name} project description.`, owner: '', audience: '', status, statusSource: status ? { type: 'manual', at: iso(set) } : null, createdAt: iso(created) })
const report = (id, projectId, title, status, ago) => ({ id, projectId, title, originalUpdate: 'Raw update text.', periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: iso(ago), updatedAt: null, source: 'ai', projectStatusAtReport: status, content: body(title) })
const DATA = {
  version: 1,
  projects: [
    project('p1', 'Payment Platform Upgrade', 'On Track', 40 * D, 3 * D),
    project('p2', 'Customer Portal Revamp', 'At Risk', 38 * D, 1 * D),
    project('p3', 'Vendor Management System', 'On Track', 30 * D, 6 * D),
    project('p4', 'Enterprise Customer Onboarding Automation Programme', 'Blocked', 25 * D, 10 * D),
    project('p5', 'Data Warehouse Migration', 'Off Track', 20 * D, 8 * D),
    project('p6', 'Compliance Reporting', null, 15 * D, 5 * D),
  ],
  reports: [
    report('r1', 'p1', 'Payment Platform Upgrade – Weekly Status Report', 'On Track', 2 * H),
    report('r2', 'p4', 'Enterprise Customer Onboarding Automation Programme – Fortnightly Status Report', 'Blocked', 26 * H),
    report('r3', 'p3', 'Vendor Management System', 'On Track', 28 * H),
    report('r4', 'p2', 'Customer Portal Revamp – Weekly Status Report', 'At Risk', 50 * H),
    report('r5', 'p5', 'Data Warehouse Migration – Weekly Status Report', 'Off Track', 70 * H),
  ],
}
// every screen to check. Add new pages here when they are built.
const PAGES = [
  ['Overview', '#/'],
  ['Projects', '#/projects'],
  ['Project workspace', '#/projects/p4'],
  ['Reports', '#/reports'],
  ['Report', '#/reports/r2'],
  ['New report', '#/projects/p1/new-report'],
  // last: loads the demo workspace (through its real button) so the Overview shows sample activity, a full-height Recent Reports card, etc.
  ['Overview with demo workspace', '#/', 'demo'],
]

// ---------- find a browser ----------
function findBrowser() {
  const candidates = [
    process.env.BROWSER_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter(Boolean)
  const hit = candidates.find((p) => existsSync(p))
  if (!hit) throw new Error('No Chrome or Edge found. Set BROWSER_PATH to its executable.')
  return hit
}
const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(path.join(root, 'dist/index.html'))) {
  console.error('There is no build yet. Run "npm run build" first.')
  process.exit(2)
}

// ---------- start the app (no API key, no .env, no network) ----------
const appPort = await freePort()
const cwd = mkdtempSync(path.join(tmpdir(), 'status-ai-responsive-'))
const server = spawn(process.execPath, [path.join(root, 'server/index.js')], {
  cwd,
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'production', PORT: String(appPort) },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${appPort}`
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base + '/api/health')).ok) break
  } catch {
    /* not up yet */
  }
  await sleep(250)
}

// ---------- drive the browser over the DevTools protocol ----------
const debugPort = await freePort()
const profile = mkdtempSync(path.join(tmpdir(), 'status-ai-browser-'))
const browser = spawn(findBrowser(), ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' })
let page
for (let i = 0; i < 80 && !page; i++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
    page = targets.find((t) => t.type === 'page')
  } catch {
    /* not up yet */
  }
  if (!page) await sleep(250)
}
if (!page) throw new Error('could not reach the browser')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let nextId = 0
const waiting = new Map()
const errors = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && waiting.has(d.id)) {
    waiting.get(d.id)(d)
    waiting.delete(d.id)
  }
  if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.text)
}
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation failed')
  return r.result.result.value
}
await send('Runtime.enable')
await send('Page.enable')

// what to inspect in the page (runs in the browser)
const INSPECT = `(() => {
  const vw = document.documentElement.clientWidth
  const problems = []
  const visible = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const inClosedDrawer = (e) => !!e.closest('.side:not(.open)') && getComputedStyle(document.querySelector('.side')).position === 'fixed'
  const label = (e) => (e.className && typeof e.className === 'string' ? e.tagName.toLowerCase() + '.' + e.className.split(' ')[0] : e.tagName.toLowerCase()) + ' "' + (e.innerText || '').trim().slice(0, 30).replace(/\\s+/g, ' ') + '"'
  const out = { vw, overflowX: document.documentElement.scrollWidth - vw, problems }
  // content beyond the right edge (not inside a deliberately scrolling area, not the closed drawer)
  for (const e of document.querySelectorAll('body *')) {
    if (!visible(e) || inClosedDrawer(e)) continue
    if (e.closest('svg') && e.tagName !== 'svg') continue
    const r = e.getBoundingClientRect()
    if (r.right > vw + 1 || r.left < -1) {
      let scroller = false
      for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scroller = true; break } }
      if (!scroller) problems.push('beyond the screen edge: ' + label(e) + ' (' + Math.round(r.left) + '..' + Math.round(r.right) + ' of ' + vw + ')')
    }
  }
  // clipped text: hidden overflow without an ellipsis or line clamp
  for (const e of document.querySelectorAll('h1,h2,h3,h4,p,span,strong,a,button,label,li,td,th,dt,dd')) {
    if (!visible(e) || inClosedDrawer(e)) continue
    const cs = getComputedStyle(e)
    if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp?.match(/^[1-9]/) && cs.display !== 'inline') problems.push('clipped text: ' + label(e))
  }
  // controls must be big enough to use and fully on screen
  for (const e of document.querySelectorAll('button:not([disabled]),a[href],input,select,textarea')) {
    if (!visible(e) || inClosedDrawer(e)) continue
    const r = e.getBoundingClientRect()
    if (r.width < 24 || r.height < 24) { if (!e.closest('p,li,dd,dt,.crumbs,.foot,.info,.rr-foot,.act-text,.view-all,.legend,.pager,label') && e.tagName !== 'INPUT') problems.push('control too small: ' + label(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)) }
  }
  // navigation: a sidebar from 900px, a working menu button below that
  const burger = document.querySelector('.burger')
  const side = document.querySelector('.side')
  const burgerShown = !!burger && burger.offsetParent !== null
  const sideRect = side.getBoundingClientRect()
  out.nav = { burgerShown, sideLeft: Math.round(sideRect.left), sideWidth: Math.round(sideRect.width) }
  if (vw >= 900 && (burgerShown || sideRect.left < 0)) problems.push('sidebar should be visible at this width')
  if (vw < 900 && !burgerShown) problems.push('menu button missing')
  // Overview dashboard specifics
  const dash = document.querySelector('.dash')
  if (dash) {
    const h1 = dash.querySelector('.dash-head h1').getBoundingClientRect()
    const btns = [...dash.querySelectorAll('.dash-actions button')].map((b) => b.getBoundingClientRect())
    const dw = dash.getBoundingClientRect().width
    out.dash = { width: Math.round(dw), buttons: btns.map((b) => [Math.round(b.left), Math.round(b.top), Math.round(b.width)]), h1Top: Math.round(h1.top) }
    if (btns.length !== 2) problems.push('header should have exactly two actions')
    else {
      const [soon, create] = btns
      if (!(create.left > soon.left)) problems.push('New Project must be the rightmost action')
      if (Math.abs(create.top - soon.top) > 4 && dw >= 560) problems.push('header actions are not on one row')
      if (dw >= 560 && create.top > h1.bottom - 2) problems.push('New Project dropped underneath the heading')
      if (create.right > dash.getBoundingClientRect().right + 1) problems.push('New Project is outside the dashboard')
    }
    const soonBtn = dash.querySelector('.btn-soon')
    if (!soonBtn.disabled || !/coming soon/i.test(soonBtn.innerText)) problems.push('Integrations must stay disabled and labelled Coming Soon')
    for (const li of dash.querySelectorAll('.legend li')) if (li.getBoundingClientRect().height > 32) problems.push('Project Health label wraps: ' + li.innerText.replace(/\\s+/g, ' ').trim())
    const cards = [...dash.querySelectorAll('.sum')].map((c) => c.getBoundingClientRect())
    out.cards = cards.map((c) => [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)])
    if (cards.some((c) => c.width < 120)) problems.push('a summary card is narrower than 120px')
    for (const l of dash.querySelectorAll('.sum-label, .sum-num')) if (l.scrollWidth > l.clientWidth + 1) problems.push('summary text clipped: ' + l.innerText)
    const donut = dash.querySelector('.donut svg').getBoundingClientRect()
    const hc = dash.querySelector('.health').getBoundingClientRect()
    const rc = dash.querySelector('.recent').getBoundingClientRect()
    if (donut.width > hc.width) problems.push('donut wider than its card')
    if (donut.right > hc.right || donut.left < hc.left || donut.bottom > hc.bottom || donut.top < hc.top) problems.push('donut is clipped by or outside its card')
    const sideBySide = Math.abs(hc.top - rc.top) < 2 && rc.left > hc.left
    out.cardsRow = { sideBySide, healthHeight: Math.round(hc.height), recentHeight: Math.round(rc.height), donut: Math.round(donut.width) }
    if (sideBySide && (Math.abs(hc.bottom - rc.bottom) > 1 || Math.abs(hc.height - rc.height) > 1)) problems.push('Project Health and Recent Reports are not the same height (' + Math.round(hc.height) + ' vs ' + Math.round(rc.height) + ')')
    // the legend and donut stay inside the card and the legend is vertically centred with the donut when side by side
    const legend = dash.querySelector('.legend').getBoundingClientRect()
    if (legend.right > hc.right + 1) problems.push('legend runs past the Project Health card')
    if (sideBySide && Math.abs((legend.top + legend.height / 2) - (donut.top + donut.height / 2)) > 4 && legend.left > donut.right) problems.push('donut and legend are not vertically centred together')
    const acts = [...dash.querySelectorAll('.act li')]
    for (const li of acts) { const r = li.getBoundingClientRect(); if (r.right > dash.getBoundingClientRect().right + 1) problems.push('an activity entry runs past its card'); const t = li.querySelector('.act-text'); if (t && t.scrollWidth > t.clientWidth + 1) problems.push('activity text is clipped') }
    for (const r of dash.querySelectorAll('.rr')) {
      const t = r.querySelector('.rr-title'), p = r.querySelector('.pill'), d = r.querySelector('.rr-date')
      const tr = t.getBoundingClientRect(), pr = p.getBoundingClientRect(), dr = d.getBoundingClientRect()
      const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
      if (overlap(tr, pr) || overlap(dr, pr) || overlap(tr, dr)) problems.push('report row elements overlap: ' + t.innerText.slice(0, 30))
    }
  }
  return out
})()`

const results = []
let failed = 0
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
await send('Page.navigate', { url: base + '/' })
await sleep(800)
await evaluate(`localStorage.clear(); localStorage.setItem('statusai.v1', ${JSON.stringify(JSON.stringify(DATA))}); true`)

const seedStorage = () => evaluate(`localStorage.clear(); localStorage.setItem('statusai.v1', ${JSON.stringify(JSON.stringify(DATA))}); true`)
const waitForApp = async () => {
  for (let i = 0; i < 40 && !(await evaluate(`!!document.querySelector('.side') && !!document.querySelector('.page')`)); i++) await sleep(150)
  await sleep(400)
}
for (const [vpName, w, h, mobile] of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await seedStorage()
  const row = []
  for (const [pageName, hash, prepare] of PAGES) {
    if (prepare === 'demo') {
      await send('Page.navigate', { url: base + '/#/projects' })
      await evaluate(`location.reload(), true`)
      await waitForApp()
      await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Load Demo Workspace')?.click(); true`)
      await sleep(700)
    }
    await send('Page.navigate', { url: base + '/' + hash })
    await evaluate(`location.reload(), true`)
    await waitForApp()
    const r = await evaluate(INSPECT)
    const problems = [...r.problems]
    if (r.overflowX > 1) problems.unshift(`horizontal overflow of ${r.overflowX}px`)
    // phone navigation: the menu opens, fits the screen, and closes again
    if (pageName === 'Overview' && w < 900) {
      await evaluate(`document.querySelector('.burger').click(); true`)
      await sleep(350)
      const d = await evaluate(`(() => { const s = document.querySelector('.side'); const r = s.getBoundingClientRect(); return { open: s.classList.contains('open'), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), vw: document.documentElement.clientWidth, links: s.querySelectorAll('nav a').length, profile: !!s.querySelector('.side-profile') } })()`)
      if (!d.open || d.left < 0 || d.right > d.vw || d.links !== 3) problems.push('menu drawer does not open properly')
      if (d.width > d.vw * 0.82) problems.push(`menu drawer is too wide (${d.width}px of ${d.vw}px)`)
      if (!d.profile) problems.push('Workspace block missing from the menu')
      await evaluate(`document.querySelector('.scrim')?.click(); true`)
      await sleep(300)
    }
    if (SHOTS) {
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
      writeFileSync(path.join(SHOTS, `${w}x${h}-${pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`), Buffer.from(shot.result.data, 'base64'))
    }
    row.push([pageName, problems])
    failed += problems.length
  }
  results.push([vpName, w, h, row])
}

// ---------- report ----------
for (const [name, w, h, row] of results) {
  const bad = row.filter(([, p]) => p.length)
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name} (${w} x ${h})${bad.length ? '' : `  ${row.length} pages`}`)
  for (const [page, problems] of bad) for (const p of [...new Set(problems)]) console.log(`        ${page}: ${p}`)
}
if (errors.length) {
  failed += errors.length
  console.log('FAIL  uncaught page errors:\n        ' + errors.join('\n        '))
}
console.log(`\n${failed ? `${failed} problem(s) found` : 'No responsive problems found'} across ${VIEWPORTS.length} screen sizes and ${PAGES.length} pages.`)
try { ws.close() } catch { /* already closed */ }
browser.kill()
server.kill()
process.exit(failed ? 1 : 0)
