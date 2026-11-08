import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { findReportForPeriod, DUPLICATE_PERIOD_MESSAGE, comparisonBaselineFor } from '../src/history.js'

// One active saved report per project for an identical reporting period (same project, same start, same end).
// Overlapping but different periods, other projects, demo reports and sample copies are all unaffected.

const MESSAGE = 'A report already exists for this project and reporting period. You can edit the existing report or delete it before creating another.'

describe('findReportForPeriod (the single definition of a duplicate)', () => {
  const r = (over) => ({ id: 'r1', projectId: 'p1', periodStart: '2026-11-01', periodEnd: '2026-11-07', ...over })
  const find = (reports, q) => findReportForPeriod({ reports }, { projectId: 'p1', periodStart: '2026-11-01', periodEnd: '2026-11-07', ...q })

  it('uses the exact wording the product asked for', () => {
    assert.equal(DUPLICATE_PERIOD_MESSAGE, MESSAGE)
  })
  it('finds a report with the same project, start and end', () => {
    assert.equal(find([r()])?.id, 'r1')
  })
  it('does not match a different start, a different end, or a different project', () => {
    assert.equal(find([r({ periodStart: '2026-11-02' })]), null)
    assert.equal(find([r({ periodEnd: '2026-11-08' })]), null)
    assert.equal(find([r({ projectId: 'p2' })]), null)
  })
  it('does not treat overlapping, adjacent or nested periods as duplicates', () => {
    assert.equal(find([r({ periodStart: '2026-11-05', periodEnd: '2026-11-12' })]), null)
    assert.equal(find([r({ periodStart: '2026-11-08', periodEnd: '2026-11-14' })]), null)
    assert.equal(find([r({ periodStart: '2026-11-02', periodEnd: '2026-11-03' })]), null)
  })
  it('ignores demo reports and sample copies', () => {
    assert.equal(find([r({ demo: true })]), null)
    assert.equal(find([r({ demo: true, sampleCopy: true })]), null)
  })
  it('can exclude one report by id, so a report never collides with itself', () => {
    assert.equal(find([r()], { excludeId: 'r1' }), null)
  })
  it('never matches when the candidate has no usable project or dates', () => {
    assert.equal(find([r()], { projectId: '' }), null)
    assert.equal(find([r()], { periodStart: '' }), null)
    assert.equal(find([r()], { periodEnd: 'not-a-date' }), null)
    assert.equal(find([r({ periodStart: undefined })], { periodStart: undefined }), null)
  })
})

describe('store.addReport refuses a duplicate period', () => {
  let storage, store, project, other
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    other = store.actions.createProject(projectInput({ name: 'Beta Project' }))
  })
  afterEach(releaseStorage)
  // always the same explicit period unless a test chooses another
  const save = (over = {}, id = project.id) => store.actions.addReport(reportInput(id, { periodStart: '2026-11-01', periodEnd: '2026-11-07', ...over }))

  it('rejects a second report for the same project and exact period, with a typed error', () => {
    const first = save()
    assert.throws(
      () => save({ title: 'Second' }),
      (e) => e instanceof store.DuplicatePeriodError && e.code === 'DUPLICATE_PERIOD' && e.existingReportId === first.id && e.message === MESSAGE,
    )
  })
  it('does not overwrite or change the existing report, and writes nothing', () => {
    const first = save({ originalUpdate: 'first update' })
    const before = JSON.stringify(readPersisted(storage))
    const writes = storage.writes.length
    assert.throws(() => save({ originalUpdate: 'second update', content: content({ executiveSummary: 'Other' }) }))
    assert.equal(JSON.stringify(readPersisted(storage)), before)
    assert.equal(storage.writes.length, writes)
    const stored = readPersisted(storage).reports
    assert.equal(stored.length, 1)
    assert.equal(stored[0].id, first.id)
    assert.equal(stored[0].originalUpdate, 'first update')
  })
  it('refuses on a rapid second save of the same draft (double submit)', () => {
    save()
    assert.throws(() => save(), store.DuplicatePeriodError)
    assert.equal(readPersisted(storage).reports.length, 1)
  })
  it('allows the same dates for another project', () => {
    save()
    assert.doesNotThrow(() => save({}, other.id))
    assert.equal(readPersisted(storage).reports.length, 2)
  })
  it('allows a different period, including an overlapping one (existing overlap handling is kept)', () => {
    save()
    assert.doesNotThrow(() => save({ periodStart: '2026-11-08', periodEnd: '2026-11-14' }))
    assert.doesNotThrow(() => save({ periodStart: '2026-11-05', periodEnd: '2026-11-12' }))
    assert.doesNotThrow(() => save({ periodStart: '2026-11-01', periodEnd: '2026-11-06' }))
    assert.equal(readPersisted(storage).reports.length, 4)
  })
  it('allows saving again once the existing report has been deleted', () => {
    const first = save()
    store.actions.deleteReport(first.id)
    const replacement = save({ title: 'Replacement' })
    assert.notEqual(replacement.id, first.id)
    assert.deepEqual(readPersisted(storage).reports.map((r) => r.title), ['Replacement'])
  })
  it('is not blocked by demo reports or sample copies for the same dates', () => {
    store.actions.loadDemo()
    const s = readPersisted(storage)
    const demoReport = s.reports.find((r) => r.demo)
    assert.ok(demoReport)
    // a real report for the same project and the same dates as a demo report is fine
    assert.doesNotThrow(() => save({ periodStart: demoReport.periodStart, periodEnd: demoReport.periodEnd }, demoReport.projectId))
    const copy = store.actions.saveSampleCopy({ projectId: demoReport.projectId, content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07' })
    assert.ok(copy.sampleCopy)
    assert.doesNotThrow(() => save({}, demoReport.projectId))
  })
  it('a sample copy can be saved repeatedly for the same period (the rule is for real reports)', () => {
    const a = { projectId: project.id, content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07' }
    store.actions.saveSampleCopy(a)
    assert.doesNotThrow(() => store.actions.saveSampleCopy(a))
  })
  it('still requires a finalised status first (the existing guard is unchanged)', () => {
    assert.throws(() => save({ projectStatusAtReport: null }), /finalised/)
  })
  it('reports already holding a duplicate in storage are left untouched and still load', async () => {
    const a = save()
    const raw = readPersisted(storage)
    raw.reports.push({ ...raw.reports[0], id: 'legacy-dup', savedAt: '2026-11-09T00:00:00.000Z' })
    storage.data.set('statusai.v1', JSON.stringify(raw))
    releaseStorage()
    const fresh = await loadStore(storage)
    assert.equal(readPersisted(storage).reports.length, 2) // nothing deleted or merged
    assert.throws(() => fresh.actions.addReport(reportInput(a.projectId, { periodStart: '2026-11-01', periodEnd: '2026-11-07' })), fresh.DuplicatePeriodError)
    // the baseline logic that already copes with duplicates keeps working
    const later = comparisonBaselineFor(readPersisted(storage), { projectId: a.projectId, periodStart: '2026-11-08', periodEnd: '2026-11-14' })
    assert.equal(later.status, 'found')
    assert.ok(later.notes.some((n) => /More than one report/.test(n)))
  })
})

describe('editing a saved report is never treated as a duplicate', () => {
  let storage, store, project, report
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    report = store.actions.addReport(reportInput(project.id, { periodStart: '2026-11-01', periodEnd: '2026-11-07' }))
  })
  afterEach(releaseStorage)

  it('updating content works and keeps the period, the id and the single record', () => {
    store.actions.updateReportContent(report.id, content({ executiveSummary: 'Edited summary.' }))
    const [stored, ...rest] = readPersisted(storage).reports
    assert.equal(rest.length, 0)
    assert.equal(stored.id, report.id)
    assert.equal(stored.content.executiveSummary, 'Edited summary.')
    assert.equal(stored.periodStart, '2026-11-01')
    assert.equal(stored.periodEnd, '2026-11-07')
  })
  it('changing the PM-finalised Project Health works', () => {
    const entry = store.actions.updateReportStatus(report.id, 'Blocked')
    assert.ok(entry)
    const stored = readPersisted(storage).reports[0]
    assert.equal(stored.projectStatusAtReport, 'Blocked')
    assert.equal(readPersisted(storage).reports.length, 1)
  })
  it('the report itself is excluded when checking its own period', () => {
    const state = readPersisted(storage)
    const q = { projectId: project.id, periodStart: report.periodStart, periodEnd: report.periodEnd }
    assert.equal(findReportForPeriod(state, q).id, report.id)
    assert.equal(findReportForPeriod(state, { ...q, excludeId: report.id }), null)
  })
})
