import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { emailReport, metaOf } from '../src/exporters.js'
import { metaLines, reportToText } from '../src/sections.js'
import { STATUSES, INSUFFICIENT, isFinalStatus } from '../src/schema.js'

// The PM owns the final project status. Only that status ever reaches stakeholders, written simply as
// "Project Health: <status>". The AI assessment is internal decision support and is never exported.

// distinctive strings that must never leave the app
const SECRET_QUOTE = 'Vendor sandbox credentials still outstanding'
const SECRET_EXPLANATION = 'Internal reasoning about the credential delay'
const SECRET_MISSING = 'Internal note: no date for credentials'
const ASSESSMENT = (outcome = 'Blocked') => ({
  outcome,
  explanation: SECRET_EXPLANATION,
  evidence: [{ source: 'update', quote: SECRET_QUOTE }],
  missingInformation: [SECRET_MISSING],
  checks: { evidenceDropped: 0, downgradedFrom: null },
})
const FORBIDDEN = [
  SECRET_QUOTE, SECRET_EXPLANATION, SECRET_MISSING,
  /AI recommend/i, /recommend/i, /confirmed by/i, /pending review/i, /overrid/i, /assessment/i, /evidence/i, /insufficient/i,
  /ai-confirmed/i, /report-prompt/i, /stub-model/i,
]
const assertStakeholderSafe = (text) => {
  for (const f of FORBIDDEN) {
    const hit = f instanceof RegExp ? f.test(text) : text.includes(f)
    assert.equal(hit, false, `export must not contain ${f}`)
  }
}

describe('isFinalStatus', () => {
  it('accepts only the four statuses', () => {
    for (const s of STATUSES) assert.equal(isFinalStatus(s), true)
    for (const s of ['', null, undefined, INSUFFICIENT, 'Not set', 'on track', 'Green', 5, {}, ['At Risk']]) assert.equal(isFinalStatus(s), false, String(s))
  })
})

describe('Project Health in exports', () => {
  const live = (over = {}) => ({
    id: 'r1', projectId: 'p1', source: 'ai', periodStart: '2026-11-01', periodEnd: '2026-11-07',
    generatedAt: '2026-11-08T08:30:00.000Z', savedAt: '2026-11-09T09:00:00.000Z',
    projectStatusAtReport: 'At Risk', assessment: ASSESSMENT(), statusDecision: { status: 'At Risk', action: 'overridden', decidedAt: '2026-11-09T09:00:00.000Z' },
    generation: { model: 'stub-model', promptVersion: 'report-prompt-x' }, ...over,
  })
  const project = { name: 'Alpha Project' }

  for (const status of STATUSES) {
    it(`writes "Project Health: ${status}" in the copied/emailed/PDF text header`, () => {
      const lines = metaLines(metaOf(live({ projectStatusAtReport: status }), project))
      assert.ok(lines.includes(`Project Health: ${status}`), lines.join('|'))
      assert.ok(reportToText(content(), metaOf(live({ projectStatusAtReport: status }), project)).includes(`Project Health: ${status}`))
    })
  }

  it('sits straight after the project name, once', () => {
    const lines = metaLines(metaOf(live(), project))
    assert.equal(lines[0], 'Project: Alpha Project')
    assert.equal(lines[1], 'Project Health: At Risk')
    assert.equal(lines.filter((l) => l.startsWith('Project Health')).length, 1)
  })

  it('is left out when the PM never finalised a status (older reports) or the value is not a real status', () => {
    for (const projectStatusAtReport of [null, undefined, '', INSUFFICIENT, 'Not set', 'Green']) {
      const m = metaOf(live({ projectStatusAtReport }), project)
      assert.equal(m.projectHealth, null)
      assert.equal(metaLines(m).some((l) => l.startsWith('Project Health')), false)
    }
  })

  it('is left out of demo reports and sample copies (illustrative, not finalised by a PM)', () => {
    for (const over of [{ demo: true, source: 'demo' }, { demo: true, sampleCopy: true, source: 'sample-copy' }]) {
      assert.equal(metaOf(live(over), project).projectHealth, null)
    }
  })

  it('never exports the assessment, its reasoning, evidence, decision or generation details', () => {
    const text = reportToText(content({ title: 'Weekly Status Report' }), metaOf(live(), project))
    assert.match(text, /Project Health: At Risk/)
    assertStakeholderSafe(text)
  })

  it('shows the PM\'s final status, not the AI\'s, when they differ', () => {
    const text = reportToText(content(), metaOf(live({ assessment: ASSESSMENT('Off Track'), projectStatusAtReport: 'On Track' }), project))
    assert.match(text, /Project Health: On Track/)
    assert.doesNotMatch(text, /Off Track/)
  })

  it('the metadata object itself carries nothing from the assessment', () => {
    const m = metaOf(live(), project)
    assert.deepEqual(Object.keys(m).sort(), ['generatedAt', 'isSample', 'periodEnd', 'periodStart', 'projectHealth', 'projectName', 'savedAt', 'whatsChanged'])
  })

  describe('email draft', () => {
    let assigned
    beforeEach(() => {
      assigned = []
      globalThis.window = { location: { set href(v) { assigned.push(v) }, get href() { return 'http://localhost/' } } }
    })
    afterEach(() => delete globalThis.window)

    it('the body has "Project Health: <status>" and nothing from the assessment', () => {
      emailReport(content(), metaOf(live({ projectStatusAtReport: 'Blocked' }), project))
      assert.equal(assigned.length, 1)
      const body = new URL(assigned[0]).searchParams.get('body')
      assert.match(body, /Project Health: Blocked/)
      assertStakeholderSafe(body)
      assertStakeholderSafe(new URL(assigned[0]).searchParams.get('subject'))
    })
  })

  describe('PDF', () => {
    let dir, cwd
    beforeEach(() => {
      cwd = process.cwd()
      dir = mkdtempSync(path.join(tmpdir(), 'status-ai-pdf-'))
      process.chdir(dir)
    })
    afterEach(() => {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    })

    it('has the Project Health line and nothing from the assessment', async () => {
      const { downloadPdf } = await import('../src/pdf.js')
      downloadPdf(content({ title: 'Weekly Status Report' }), metaOf(live({ projectStatusAtReport: 'Off Track' }), project))
      const [file] = readdirSync(dir)
      assert.ok(file && file.endsWith('.pdf'), 'a PDF was written')
      const text = readFileSync(path.join(dir, file), 'latin1')
      assert.ok(text.includes('Project Health: Off Track'))
      assertStakeholderSafe(text)
    })
  })
})

describe('the final status is what gets stored and recorded', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    store.actions.setProjectStatus(project.id, 'On Track') // the previous status
  })
  afterEach(() => releaseStorage())
  const persisted = () => readPersisted(storage)

  it('the final status is stored on the report beside the untouched AI recommendation', () => {
    const r = store.actions.addReport(reportInput(project.id, { assessment: ASSESSMENT('Blocked'), projectStatusAtReport: 'At Risk' }))
    const saved = persisted().reports.find((x) => x.id === r.id)
    assert.equal(saved.projectStatusAtReport, 'At Risk') // what is exported
    assert.equal(saved.assessment.outcome, 'Blocked') // internal, separate
    assert.equal(saved.statusDecision.action, 'overridden')
  })

  it('changing the status goes through the existing status history, naming the report', () => {
    const r = store.actions.addReport(reportInput(project.id, { assessment: ASSESSMENT('Blocked'), projectStatusAtReport: 'Blocked' }))
    const entry = store.actions.setProjectStatus(project.id, 'Blocked', { type: 'ai-confirmed', reportId: r.id })
    assert.deepEqual([entry.previousStatus, entry.newStatus, entry.reportId], ['On Track', 'Blocked', r.id])
    assert.equal(persisted().statusHistory.at(-1).id, entry.id)
  })

  it('the previous project status is never copied onto a new report by the store', () => {
    assert.throws(() => store.actions.addReport(reportInput(project.id, { projectStatusAtReport: undefined })), /finalised/)
    assert.deepEqual(persisted().reports, [])
    assert.equal(persisted().projects[0].status, 'On Track') // and nothing changed the project
  })
})

describe('store-level guard: a user-created report needs a finalised status', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
  })
  afterEach(() => releaseStorage())
  const persisted = () => readPersisted(storage)

  for (const bad of ['', null, undefined, 'Not set', INSUFFICIENT, 'Insufficient information', 'on track', 'Green', 5, {}, ['At Risk'], ' At Risk']) {
    it('refuses ' + (JSON.stringify(bad) ?? 'undefined'), () => {
      assert.throws(() => store.actions.addReport(reportInput(project.id, { projectStatusAtReport: bad })), /project status has been finalised/)
    })
  }

  it('a refused save changes nothing: no report, no history, no project change, no write', () => {
    store.actions.setProjectStatus(project.id, 'On Track')
    const before = storage.writes.length
    const snapshot = JSON.stringify(persisted())
    assert.throws(() => store.actions.addReport(reportInput(project.id, { assessment: ASSESSMENT('Blocked'), projectStatusAtReport: '' })))
    assert.equal(JSON.stringify(persisted()), snapshot)
    assert.equal(storage.writes.length, before)
  })

  for (const status of STATUSES) {
    it('saves when the status is ' + status, () => {
      const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: status }))
      assert.equal(persisted().reports.find((x) => x.id === r.id).projectStatusAtReport, status)
    })
  }

  it('does not affect demo reports, which are not saved through addReport', () => {
    store.actions.loadDemo()
    const demoReports = persisted().reports.filter((r) => r.demo)
    assert.ok(demoReports.length > 0)
  })

  it('does not affect Save a Copy: a sample copy needs no status', () => {
    store.actions.loadDemo()
    const demoProject = persisted().projects.find((p) => p.demo)
    const copy = store.actions.saveSampleCopy({ projectId: demoProject.id, content: content(), originalUpdate: 'u', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample' })
    assert.equal(copy.sampleCopy, true)
    assert.equal(copy.projectStatusAtReport, null)
  })

  it('does not affect historical records already in storage: reports without a status still load, edit and re-save', async () => {
    const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'At Risk' }))
    const data = persisted()
    data.reports = data.reports.map((x) => ({ ...x, projectStatusAtReport: null })) // an older report with no recorded status
    const s2 = makeStorage({ 'statusai.v1': JSON.stringify(data) })
    releaseStorage()
    const reloaded = await loadStore(s2)
    reloaded.actions.updateReportContent(r.id, content({ title: 'Edited later' })) // editing never needs a status
    reloaded.actions.deleteReport('__no-such-report__')
    const back = readPersisted(s2).reports.find((x) => x.id === r.id)
    assert.equal(back.projectStatusAtReport, null)
    assert.equal(back.title, 'Edited later')
    assert.equal(s2.data.has('statusai.v1.set-aside'), false) // not treated as malformed
  })

  it('migrated version 1 reports with no status are unaffected', async () => {
    const v1 = {
      version: 1,
      projects: [{ id: 'p', name: 'P', startDate: '2026-01-01', description: 'd', owner: '', audience: '', status: null, statusSource: null, createdAt: '2026-01-01T00:00:00.000Z' }],
      reports: [{ id: 'r', projectId: 'p', title: 'Old', originalUpdate: 'raw', periodStart: '2026-01-01', periodEnd: '2026-01-07', generatedAt: '2026-01-08T09:00:00.000Z', updatedAt: null, source: 'ai', projectStatusAtReport: null, content: content() }],
    }
    const s2 = makeStorage({ 'statusai.v1': JSON.stringify(v1) })
    releaseStorage()
    const reloaded = await loadStore(s2)
    reloaded.actions.deleteReport('__no-such-report__')
    assert.equal(readPersisted(s2).reports.length, 1)
    assert.equal(readPersisted(s2).version, 2)
  })
})
