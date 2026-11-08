import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { copyReport, emailReport, metaOf } from '../src/exporters.js'
import {
  SECTIONS, reportToText, stakeholderChanges, whatsChangedView,
  WHATS_CHANGED_HEADING, NO_PREVIOUS_MESSAGE, COMPARISON_UNAVAILABLE_MESSAGE, NO_CHANGES_MESSAGE,
} from '../src/sections.js'
import { cleanWhatsChanged, validWhatsChanged, validReportV2, isFinalStatus, computeHealthMovement } from '../src/schema.js'
import { comparisonBaselineFor } from '../src/history.js'

// "What Changed Since Last Report" is the eighth section of a report. It is stakeholder-facing and goes into the
// saved report and into copy, email and PDF. The evidence quotes behind it, and the AI health assessment, never do.

const QUOTE_CUR = 'Vendor sandbox credentials were received on Tuesday.'
const QUOTE_PREV = 'Payment integration is blocked: vendor has not issued sandbox credentials'
const SECRET_ASSESSMENT = 'Internal reasoning about the credential delay'
const compared = (over = {}) => ({
  status: 'compared',
  baseline: { reportId: 'r-prev', periodStart: '2026-10-01', periodEnd: '2026-10-07' },
  notes: [],
  items: [
    { category: 'newDevelopments', state: 'new', text: 'Legal has requested a data-protection review.', evidence: { current: 'A new data-protection review has been requested by Legal.', previous: null } },
    { category: 'completedResolved', state: 'resolved', text: 'The vendor has issued the sandbox credentials.', evidence: { current: QUOTE_CUR, previous: QUOTE_PREV } },
    { category: 'continuingBlockers', state: 'unclear', text: `Previously reported: "Escalate the vendor request". The current update does not confirm what has happened since.`, evidence: { current: null, previous: 'Escalate the vendor request' } },
    { category: 'risks', state: 'changed', text: 'The go-live risk has increased.', evidence: { current: 'go-live is now at serious risk', previous: 'Go-live may slip' } },
  ],
  ...over,
})
// what the store keeps: it adds project health movement itself (here the baseline report is not in the store, so
// the previous status is "not recorded" and the current one is the default test status).
const storedAs = (wc, previous = null, current = 'At Risk') => ({ ...wc, healthMovement: computeHealthMovement(previous, current) })
const none = () => ({ status: 'none', baseline: null, notes: [], items: [] })
const unavailable = () => ({ status: 'unavailable', baseline: null, notes: [], items: [] })
const live = (wc, over = {}) => ({
  id: 'r1', projectId: 'p1', source: 'ai', periodStart: '2026-11-01', periodEnd: '2026-11-07',
  generatedAt: '2026-11-08T08:30:00.000Z', savedAt: '2026-11-09T09:00:00.000Z', projectStatusAtReport: 'At Risk',
  assessment: { outcome: 'Blocked', explanation: SECRET_ASSESSMENT, evidence: [{ source: 'update', quote: 'secret quote text here' }], missingInformation: [] },
  whatsChanged: wc, ...over,
})
const textOf = (r, c = content()) => reportToText(c, metaOf(r, { name: 'Alpha Project' }))

// nothing but the stakeholder text may leave the app
const assertNoInternals = (text) => {
  for (const bad of [QUOTE_CUR, QUOTE_PREV, 'A new data-protection review has been requested by Legal.', 'go-live is now at serious risk', 'Evidence', SECRET_ASSESSMENT, 'secret quote text here', 'currentQuote', 'previousQuote', /recommend/i, /confidence/i, /prompt/i, /model/i, /Insufficient/i]) {
    const hit = bad instanceof RegExp ? bad.test(text) : text.includes(bad)
    assert.equal(hit, false, `export must not contain ${bad}`)
  }
}

describe('the eighth section in copied / emailed text', () => {
  it('uses the exact heading, after the existing seven sections, which are unchanged', () => {
    const text = textOf(live(compared()))
    const lines = text.split('\n')
    const at = (h) => lines.indexOf(h)
    const sevenAt = SECTIONS.map((s) => at(s.label.toUpperCase()))
    assert.ok(sevenAt.every((i) => i > 0), 'all seven sections present')
    assert.deepEqual([...sevenAt].sort((a, b) => a - b), sevenAt, 'in the original order')
    assert.equal(WHATS_CHANGED_HEADING, "What Changed Since Last Report")
    const eighth = at("What Changed Since Last Report")
    assert.ok(eighth > sevenAt.at(-1))
    assert.equal(lines.filter((l) => l === "What Changed Since Last Report").length, 1)
    assert.equal(SECTIONS.length, 7)
  })

  it('shows the real changes grouped by category, each marked New / Resolved / Update / Status unclear', () => {
    const text = textOf(live(compared()))
    for (const expected of [
      'Compared with the report for', 'New developments', '- New: Legal has requested a data-protection review.',
      'Completed or resolved', '- Resolved: The vendor has issued the sandbox credentials.',
      'Continuing blockers', '- Status unclear: Previously reported: "Escalate the vendor request".',
      'Changing risks', '- Update: The go-live risk has increased.',
    ]) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes('Executive actions') && !text.includes('\nProgress\n'), 'categories with nothing in them are not shown')
  })

  it('says "No previous report available for comparison." for a first report, as a plain statement', () => {
    const text = textOf(live(none()))
    assert.ok(text.includes(`${WHATS_CHANGED_HEADING}\n${NO_PREVIOUS_MESSAGE}`))
    assert.equal(NO_PREVIOUS_MESSAGE, 'No previous report available for comparison.')
    const section = text.split(WHATS_CHANGED_HEADING)[1]
    assert.doesNotMatch(section, /problem|issue|missing|unable|fail|error|concern/i) // absence of history is not presented as a project problem
  })

  it('says so honestly when the comparison could not be completed, and when nothing could be established', () => {
    assert.ok(textOf(live(unavailable())).includes(COMPARISON_UNAVAILABLE_MESSAGE))
    assert.ok(textOf(live(compared({ items: [] }))).includes(NO_CHANGES_MESSAGE))
  })

  it('includes notes about uncertain comparisons (overlap, duplicates, back-dating)', () => {
    const text = textOf(live(compared({ notes: ['The previous report\'s reporting period overlaps this one.'] })))
    assert.ok(text.includes("Note: The previous report's reporting period overlaps this one."))
  })

  it('never contains evidence quotes, assessment details, or model / prompt information', () => {
    assertNoInternals(textOf(live(compared())))
    assertNoInternals(textOf(live(none())))
  })

  it('keeps the PM\'s final Project Health line, and still only that for health', () => {
    const text = textOf(live(compared()))
    assert.match(text, /Project Health: At Risk/)
    assert.doesNotMatch(text, /Blocked/)
  })

  it('leaves out the section for older reports (no comparison was made), demo reports and sample copies', () => {
    for (const r of [live(undefined), live(null), live(compared(), { demo: true, source: 'demo' }), live(compared(), { demo: true, sampleCopy: true, source: 'sample-copy' })]) {
      assert.ok(!textOf(r).includes("What Changed"), 'section absent')
    }
  })

  it('ignores a malformed comparison instead of exporting it', () => {
    for (const bad of ['x', 5, [], { status: 'maybe' }]) assert.ok(!textOf(live(bad)).includes("What Changed"))
  })

  it('the seven-section text is identical with or without the eighth section', () => {
    const base = textOf(live(undefined))
    const withEighth = textOf(live(compared()))
    assert.ok(withEighth.startsWith(base))
  })
})

describe('the data handed to every export', () => {
  it('carries stakeholder text only: no evidence', () => {
    const m = metaOf(live(compared()), { name: 'P' })
    assert.equal(m.whatsChanged.status, 'compared')
    assert.equal(JSON.stringify(m).includes('evidence'), false)
    assert.equal(JSON.stringify(m).includes(QUOTE_CUR), false)
    assert.deepEqual(Object.keys(m.whatsChanged.items[0]).sort(), ['category', 'index', 'state', 'text'])
  })

  it('whatsChangedView only shows non-empty categories, in a fixed order', () => {
    const v = whatsChangedView(stakeholderChanges(compared()))
    assert.deepEqual(v.groups.map((g) => g.key), ['newDevelopments', 'completedResolved', 'continuingBlockers', 'risks'])
  })
})

describe('email, copy and PDF', () => {
  describe('email draft', () => {
    let assigned
    beforeEach(() => {
      assigned = []
      globalThis.window = { location: { set href(v) { assigned.push(v) }, get href() { return 'http://localhost/' } } }
    })
    afterEach(() => delete globalThis.window)

    it('has the eighth section and no internals', () => {
      emailReport(content(), metaOf(live(compared()), { name: 'P' }))
      const body = new URL(assigned[0]).searchParams.get('body')
      assert.ok(body.includes("What Changed Since Last Report"))
      assert.ok(body.includes('- New: Legal has requested a data-protection review.'))
      assertNoInternals(body)
    })

    it('a first report says no previous report is available', () => {
      emailReport(content(), metaOf(live(none()), { name: 'P' }))
      assert.ok(new URL(assigned[0]).searchParams.get('body').includes(NO_PREVIOUS_MESSAGE))
    })
  })

  describe('copy', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    let copied
    beforeEach(() => {
      copied = null
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied = t } } } })
    })
    afterEach(() => {
      if (original) Object.defineProperty(globalThis, 'navigator', original)
      else delete globalThis.navigator
    })

    it('copies the report with the eighth section and no internals', async () => {
      await copyReport(content(), metaOf(live(compared()), { name: 'P' }))
      assert.ok(copied.includes("What Changed Since Last Report"))
      assert.ok(copied.includes('- Resolved: The vendor has issued the sandbox credentials.'))
      assertNoInternals(copied)
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
    const pdfText = async (wc) => {
      const { downloadPdf } = await import('../src/pdf.js')
      downloadPdf(content({ title: 'Weekly Status Report' }), metaOf(live(wc), { name: 'Alpha Project' }))
      return readFileSync(path.join(dir, readdirSync(dir)[0]), 'latin1')
    }

    it('has the eighth section after the seven, and no internals', async () => {
      const t = await pdfText(compared())
      assert.ok(t.includes("What Changed Since Last Report"))
      assert.ok(t.indexOf("What Changed Since Last Report") > t.indexOf('Executive Action Required'))
      assert.ok(t.includes('New: Legal has requested a data-protection review.'))
      assert.ok(t.includes('Project Health: At Risk'))
      for (const s of SECTIONS) assert.ok(t.includes(s.label), s.label)
      assertNoInternals(t)
    })

    it('a first report says no previous report is available', async () => {
      assert.ok((await pdfText(none())).includes(NO_PREVIOUS_MESSAGE))
    })

    it('an old report without a comparison has no eighth section', async () => {
      assert.ok(!(await pdfText(undefined)).includes("What Changed"))
    })
  })
})

describe('the comparison in the saved report', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
  })
  afterEach(() => releaseStorage())
  const persisted = () => readPersisted(storage)
  const save = (over = {}) => store.actions.addReport(reportInput(project.id, over))
  const saved = (id) => persisted().reports.find((r) => r.id === id)

  it('is stored with the report, together with the version as the AI produced it', () => {
    const r = save({ whatsChanged: compared(), generatedWhatsChanged: compared() })
    assert.deepEqual(saved(r.id).whatsChanged, storedAs(compared()))
    assert.deepEqual(saved(r.id).generatedWhatsChanged, compared())
    assert.ok(validReportV2(saved(r.id)))
  })

  it('keeps the AI original when the PM removed an item before saving', () => {
    const final = compared({ items: compared().items.slice(1) })
    const r = save({ whatsChanged: final, generatedWhatsChanged: compared() })
    assert.equal(saved(r.id).whatsChanged.items.length, 3)
    assert.equal(saved(r.id).generatedWhatsChanged.items.length, 4)
  })

  it('stores the "no previous report" and "unavailable" outcomes as they are, with no baseline or items', () => {
    assert.equal(saved(save({ whatsChanged: none(), generatedWhatsChanged: none() }).id).whatsChanged.status, 'none')
    assert.equal(saved(save({ whatsChanged: unavailable(), generatedWhatsChanged: unavailable() }).id).whatsChanged.status, 'unavailable')
  })

  it('does not store a comparison that is not internally consistent (no invented history)', () => {
    for (const bad of [
      { ...compared(), baseline: null },
      { ...none(), items: compared().items },
      { ...none(), baseline: compared().baseline },
      { ...compared(), items: [{ category: 'gossip', state: 'new', text: 'x' }] },
      { ...compared(), items: [{ category: 'risks', state: 'resolved', text: '   ' }] },
      { status: 'compared' }, 'compared', 7,
    ]) {
      assert.equal(validWhatsChanged(bad), false, JSON.stringify(bad)?.slice(0, 70))
      assert.equal(cleanWhatsChanged(bad), null)
      assert.equal(saved(save({ whatsChanged: bad }).id).whatsChanged, null)
    }
  })

  it('stores its own copy: changing the object that was passed in changes nothing', () => {
    const wc = compared()
    const r = save({ whatsChanged: wc, generatedWhatsChanged: wc })
    wc.items[0].text = 'tampered'
    wc.items.pop()
    store.actions.deleteReport('__no-such-report__')
    assert.equal(saved(r.id).whatsChanged.items[0].text, 'Legal has requested a data-protection review.')
    assert.equal(saved(r.id).whatsChanged.items.length, 4)
  })

  it('editing the report text never changes the comparison', () => {
    const r = save({ whatsChanged: compared(), generatedWhatsChanged: compared() })
    store.actions.updateReportContent(r.id, content({ title: 'Edited by the PM' }))
    assert.deepEqual(saved(r.id).whatsChanged, storedAs(compared()))
  })

  it('reports saved without a comparison (older reports) have none, and still export', () => {
    const r = save()
    assert.equal(saved(r.id).whatsChanged, null)
    assert.ok(!textOf(saved(r.id)).includes("What Changed"))
  })

  it('still needs a finalised status, and keeps every other part of the report', () => {
    assert.throws(() => save({ projectStatusAtReport: '', whatsChanged: compared() }), /finalised/)
    const r = save({ whatsChanged: compared(), projectStatusAtReport: 'Off Track', periodStart: '2026-11-01', periodEnd: '2026-11-07' })
    const s = saved(r.id)
    assert.equal(isFinalStatus(s.projectStatusAtReport), true)
    assert.equal(s.originalUpdate, reportInput(project.id).originalUpdate)
    assert.deepEqual(s.generatedContent, content())
    assert.deepEqual(s.content, content())
    assert.equal(s.periodStart, '2026-11-01')
    assert.equal(s.periodEnd, '2026-11-07')
  })

  it('saving a comparison does not touch earlier reports or the project\'s status', () => {
    const first = save({ periodStart: '2026-10-01', periodEnd: '2026-10-07' })
    store.actions.setProjectStatus(project.id, 'On Track')
    const before = structuredClone({ reports: persisted().reports, project: persisted().projects[0], history: persisted().statusHistory })
    save({ periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'On Track', whatsChanged: compared({ baseline: { reportId: first.id, periodStart: '2026-10-01', periodEnd: '2026-10-07' } }) })
    assert.deepEqual(persisted().reports.find((r) => r.id === first.id), before.reports.find((r) => r.id === first.id))
    assert.deepEqual(persisted().projects[0], before.project)
    assert.deepEqual(persisted().statusHistory, before.history)
  })

  it('a saved report becomes the baseline for the next one (real store data, by period end, no self-comparison)', () => {
    const first = save({ periodStart: '2026-10-01', periodEnd: '2026-10-07' })
    const second = save({ periodStart: '2026-10-08', periodEnd: '2026-10-14' })
    const state = persisted()
    assert.equal(comparisonBaselineFor(state, { projectId: project.id, periodStart: '2026-10-15', periodEnd: '2026-10-21' }).report.id, second.id)
    assert.equal(comparisonBaselineFor(state, { id: second.id }).report.id, first.id)
    assert.equal(comparisonBaselineFor(state, { id: first.id }).status, 'none')
  })

  it('a deleted baseline does not break a saved comparison', () => {
    const first = save({ periodStart: '2026-10-01', periodEnd: '2026-10-07' })
    const second = save({ periodStart: '2026-10-08', periodEnd: '2026-10-14', whatsChanged: compared({ baseline: { reportId: first.id, periodStart: '2026-10-01', periodEnd: '2026-10-07' } }) })
    store.actions.deleteReport(first.id)
    assert.equal(saved(second.id).whatsChanged.status, 'compared')
    assert.ok(textOf(saved(second.id)).includes("What Changed Since Last Report"))
  })

  it('survives a reload unchanged', async () => {
    const r = save({ whatsChanged: compared(), generatedWhatsChanged: compared() })
    releaseStorage()
    const reloaded = await loadStore(storage)
    reloaded.actions.deleteReport('__no-such-report__')
    assert.equal(storage.data.has('statusai.v1.set-aside'), false)
    assert.deepEqual(saved(r.id).whatsChanged, storedAs(compared()))
  })
})
