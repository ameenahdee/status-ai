import { describe, it, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeStorage, loadStore, releaseStorage } from './helpers/storage.mjs'
import { projectInput, reportInput } from './helpers/fixtures.mjs'

// Renders the real Overview (src/Overview.jsx) on the server with Vite (already a dev dependency) from data saved in a
// fake browser storage. Clicking and layout are covered by the browser checks.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// `prepare(actions)` saves data the way the app does; the Overview then loads it like a fresh page.
async function overview(prepare) {
  const storage = makeStorage()
  const store = await loadStore(storage)
  prepare?.(store.actions)
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  try {
    const Overview = (await vite.ssrLoadModule('/src/Overview.jsx')).default
    return renderToStaticMarkup(React.createElement(Overview))
  } finally {
    await vite.close()
    releaseStorage()
  }
}
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const sums = (h) => [...h.matchAll(/class="sum (\w+)"[\s\S]*?class="sum-num">(\d+)<\/span><span class="sum-label">([^<]+)</g)].map((m) => [m[3], Number(m[2])])
const AI = (outcome) => ({ outcome, explanation: 'x', evidence: [{ source: 'update', quote: 'some quote here' }], missingInformation: [] })

afterEach(() => mock.timers.reset())

describe('dashboard: header', () => {
  it('has the heading, subtitle, a disabled "Coming Soon" Integrations control and a New Project button', async () => {
    const h = await overview()
    assert.ok(text(h).includes('Overview'))
    assert.ok(text(h).includes('A real-time view of your projects, status and recent activity.'))
    const soon = h.match(/<button[^>]*btn-soon[^>]*>[\s\S]*?<\/button>/)[0]
    assert.match(soon, /disabled=""/)
    assert.match(soon, /aria-disabled="true"/)
    assert.ok(text(soon).includes('Integrations') && text(soon).includes('Coming Soon'))
    assert.ok(!/<a[^>]*>[\s\S]*Integrations/.test(h), 'Integrations is not a link')
    const create = h.match(/<button[^>]*btn-new[^>]*>[\s\S]*?<\/button>/)[0]
    assert.ok(text(create).includes('New Project'))
    assert.doesNotMatch(create, /disabled/)
  })

  it('does not suggest integrations are available anywhere else', async () => {
    const h = await overview((a) => a.createProject(projectInput()))
    assert.equal((text(h).match(/Integrations/g) ?? []).length, 1)
    assert.ok(!/slack|synced|sync with/i.test(text(h)))
  })
})

describe('dashboard: empty workspace', () => {
  it('shows zero figures, an empty chart and helpful empty states, inventing nothing', async () => {
    const h = await overview()
    assert.deepEqual(sums(h), [['Total Projects', 0], ['On Track', 0], ['At Risk', 0], ['Blocked', 0]])
    assert.match(h, /class="donut-centre"><strong>0<\/strong><span>Projects<\/span>/)
    assert.doesNotMatch(h, /class="donut-seg/) // no arcs
    assert.ok(text(h).includes('No projects yet. Create a project to see its health here.'))
    assert.ok(text(h).includes('No reports yet. Reports you generate and save will appear here.'))
    assert.ok(text(h).includes('Create your first project'))
    assert.ok(text(h).includes('Try a Sample Generation'))
    assert.ok(text(h).includes('No activity yet.'))
    assert.match(h, /On Track<\/span><span class="legend-val">0% \(0\)/)
  })
})

describe('dashboard: with data', () => {
  const build = (a) => {
    const mk = (name, status) => {
      const p = a.createProject(projectInput({ name }))
      if (status) a.setProjectStatus(p.id, status)
      return p
    }
    const p1 = mk('Alpha', 'On Track')
    mk('Beta', 'On Track')
    mk('Gamma', 'At Risk')
    mk('Delta', 'Blocked')
    mk('Epsilon', null)
    return { p1, a }
  }

  it('counts and percentages come from the projects', async () => {
    const h = await overview((a) => build(a))
    assert.deepEqual(sums(h), [['Total Projects', 5], ['On Track', 2], ['At Risk', 1], ['Blocked', 1]])
    assert.match(h, /class="donut-centre"><strong>5<\/strong>/)
    assert.match(h, /On Track<\/span><span class="legend-val">40% \(2\)/)
    assert.match(h, /At Risk<\/span><span class="legend-val">20% \(1\)/)
    assert.match(h, /Blocked<\/span><span class="legend-val">20% \(1\)/)
    assert.match(h, /Not set<\/span><span class="legend-val">20% \(1\)/) // the project with no status is shown, not hidden
    assert.ok(!text(h).includes('No projects yet'))
  })

  it('recent reports show the final PM status, link to the right report, and never the AI recommendation', async () => {
    let r1, r2
    const h = await overview((a) => {
      const { p1 } = build(a)
      // the AI recommended "Off Track" for both, but the PM finalised On Track and Blocked
      r1 = a.addReport(reportInput(p1.id, { title: 'First weekly report', projectStatusAtReport: 'On Track', assessment: AI('Off Track') }))
      r2 = a.addReport(reportInput(p1.id, { title: 'Second weekly report', projectStatusAtReport: 'Blocked', assessment: AI('Off Track'), periodStart: '2026-11-08', periodEnd: '2026-11-14' }))
    })
    const rows = h.match(/<a class="rr"[\s\S]*?<\/a>/g)
    assert.equal(rows.length, 2)
    assert.match(rows.join(''), new RegExp(`href="#/reports/${r1.id}"`))
    assert.match(rows.join(''), new RegExp(`href="#/reports/${r2.id}"`))
    const byTitle = (t) => rows.find((r) => r.includes(t))
    assert.match(byTitle('First weekly report'), /class="pill ok">On Track</)
    assert.match(byTitle('Second weekly report'), /class="pill bad">Blocked</)
    assert.ok(!text(h).includes('Off Track'), 'the AI recommendation is shown nowhere on the dashboard')
    assert.ok(text(byTitle('First weekly report')).includes('Alpha'), 'project name shown')
    assert.ok(text(h).includes('2 reports saved'))
  })

  it('recent activity shows genuine events with links', async () => {
    let report
    const h = await overview((a) => {
      mock.timers.enable({ apis: ['Date'], now: new Date() }) // events at different times, so the order is real
      const { p1 } = build(a)
      mock.timers.tick(60_000)
      a.setProjectStatus(p1.id, 'At Risk') // a status change by the PM
      mock.timers.tick(60_000)
      report = a.addReport(reportInput(p1.id, { title: 'Weekly report', projectStatusAtReport: 'At Risk', generatedAt: new Date(Date.now() - 30_000).toISOString() }))
      mock.timers.tick(60_000)
      a.updateReportStatus(report.id, 'Blocked') // the PM edits the saved report's Project Health
    })
    const t = text(h)
    assert.ok(t.includes('New report generated'))
    assert.ok(t.includes('Report saved'))
    assert.ok(t.includes('Project status updated'))
    assert.ok(t.includes('Saved report edited'))
    assert.ok(t.includes('Project Health At Risk → Blocked'), 'the report edit shows its movement')
    assert.match(h, new RegExp(`href="#/reports/${report.id}"`))
    assert.ok(!/slack/i.test(t))
    assert.ok(!t.includes('No activity yet'))
  })

  it('summary cards carry the four icon treatments inside a pale circle', async () => {
    const h = await overview()
    const section = h.slice(h.indexOf('class="dash-cards"'), h.indexOf('class="dash-grid"'))
    const cards = section.split('<div class="sum ').slice(1)
    assert.equal(cards.length, 4)
    assert.ok(cards.every((c) => c.includes('class="sum-icon"><span class="ic-in"><svg')))
    assert.deepEqual(cards.map((c) => c.slice(0, c.indexOf('"'))), ['total', 'ok', 'warn', 'bad'])
    assert.deepEqual(cards.map((c) => c.match(/sum-label">([^<]+)</)[1]), ['Total Projects', 'On Track', 'At Risk', 'Blocked'])
  })

  it('shows a newly created project in the activity', async () => {
    const h = await overview((a) => a.createProject(projectInput({ name: 'Brand New Project' })))
    assert.ok(text(h).includes('New project created'))
    assert.ok(text(h).includes('Brand New Project'))
  })

  it('shows only the five latest reports and six latest events', async () => {
    const h = await overview((a) => {
      mock.timers.enable({ apis: ['Date'], now: new Date() })
      const p = a.createProject(projectInput({ name: 'Many' }))
      for (let i = 1; i <= 7; i++) {
        mock.timers.tick(60_000)
        a.addReport(reportInput(p.id, { title: 'Report number ' + i, projectStatusAtReport: 'On Track', generatedAt: new Date(Date.now() - 30_000).toISOString() }))
      }
    })
    assert.equal(h.match(/<a class="rr"/g).length, 5)
    assert.equal(h.match(/<li class="act-/g).length, 6)
    assert.ok(text(h).includes('Report number 7') && text(h).includes('Report number 3') && !text(h).includes('Report number 2'))
    assert.ok(text(h).includes('7 reports saved'))
  })

  it('demo data counts in the figures and fills Recent Activity with sample entries labelled Demo', async () => {
    const h = await overview((a) => a.loadDemo())
    assert.deepEqual(sums(h)[0], ['Total Projects', 10])
    assert.ok(text(h).includes('Figures include 10 illustrative demo projects'))
    const section = h.slice(h.indexOf('aria-labelledby="activity-h"'), h.indexOf('</section>', h.indexOf('aria-labelledby="activity-h"')))
    assert.ok(!section.includes('No activity yet'))
    assert.ok((section.match(/<li class="act-/g) ?? []).length >= 6, 'at least six sample activities')
    assert.equal((section.match(/class="demo-badge/g) ?? []).length, (section.match(/<li class="act-/g) ?? []).length, 'every one is labelled Demo')
    for (const title of ['New project created', 'Project details updated', 'Project status updated', 'New report generated', 'Report saved', 'Saved report edited']) {
      assert.ok(section.includes(title), title)
    }
    assert.ok(text(h).includes('13 reports saved · 0 live AI · 13 demo or sample'))
    assert.match(h, /class="demo-badge/) // demo reports are labelled in Recent Reports
  })
})

describe('dashboard: the sidebar profile', () => {
  it('reads "Workspace / Personal workspace" and shows no name, job title, "Local workspace" or storage note', () => {
    const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
    const start = app.indexOf('className="side-profile"')
    assert.ok(start > 0, 'profile block exists')
    const block = app.slice(start, app.indexOf('</aside>', start))
    assert.ok(block.includes('<strong>Workspace</strong>'))
    assert.ok(block.includes('<span>Personal workspace</span>'))
    for (const bad of ['Local workspace', 'Saved in this browser', 'Amina', 'Product Manager']) assert.ok(!block.includes(bad), bad)
    assert.ok(!/signIn|login|logout|auth/i.test(block), 'no account functionality')
  })
})

describe('dashboard: the logo', () => {
  it('uses the supplied artwork on the plum sidebar, with the original file unchanged in the repo', () => {
    const app = readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
    const logo = readFileSync(path.join(root, 'src/Logo.jsx'), 'utf8')
    assert.match(app, /<Logo variant="dark" \/>/) // sidebar
    assert.match(logo, /\/logo-on-dark\.png/)
    assert.match(logo, /\/logo-on-light\.png/)
    // the files exist, are PNGs, and the untouched original sheet is stored beside them
    for (const f of ['public/logo-on-dark.png', 'public/logo-on-light.png', 'public/favicon.png', 'design/status-ai-logo-sheet.png']) {
      const b = readFileSync(path.join(root, f))
      assert.equal(b.subarray(1, 4).toString(), 'PNG', f)
    }
    const sheet = readFileSync(path.join(root, 'design/status-ai-logo-sheet.png'))
    assert.equal(sheet.readUInt32BE(16), 1536)
    assert.equal(sheet.readUInt32BE(20), 1024)
  })

  it('no longer ships the old, incorrect SVG logo', () => {
    const files = readFileSync(path.join(root, 'index.html'), 'utf8')
    assert.match(files, /href="\/favicon\.png"/)
    assert.doesNotMatch(files, /favicon\.svg/)
  })
})
