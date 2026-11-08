import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { emailReport, metaOf } from '../src/exporters.js'
import { reportToText, SECTIONS } from '../src/sections.js'
import { content } from './helpers/fixtures.mjs'

// "Email draft" works by assigning a mailto: link to window.location.href. In a real browser that opens
// the machine's default mail app, so these tests call the REAL emailReport() against a fake `window`
// that only records the assignment. No browser is involved, so nothing can ever be launched or sent.
describe('Email draft (emailReport)', () => {
  let assigned
  beforeEach(() => {
    assigned = []
    globalThis.window = {
      location: {
        set href(value) {
          assigned.push(value)
        },
        get href() {
          return 'http://localhost/'
        },
      },
    }
  })
  afterEach(() => {
    delete globalThis.window
  })

  const parse = (url) => {
    const u = new URL(url)
    return { subject: u.searchParams.get('subject'), body: u.searchParams.get('body') }
  }
  const draft = (c, meta = {}) => {
    assigned.length = 0 // each call is judged on its own
    emailReport(c, meta)
    assert.equal(assigned.length, 1, 'the link is opened exactly once')
    return { url: assigned[0], ...parse(assigned[0]) }
  }

  it('builds one mailto: link with no recipient (the user chooses who to send it to)', () => {
    const { url } = draft(content())
    assert.match(url, /^mailto:\?subject=/)
    assert.ok(!url.slice(0, 8).includes('@'))
    assert.equal(url.includes('&body='), true)
  })

  it('uses the report title as the subject', () => {
    assert.equal(draft(content({ title: 'Customer Portal – Weekly Status Report' })).subject, 'Customer Portal – Weekly Status Report')
  })

  it('falls back to a default subject when the report has no title', () => {
    assert.equal(draft(content({ title: '' })).subject, 'Project Status Report')
    assert.equal(draft(content({ title: undefined })).subject, 'Project Status Report')
  })

  it('puts the whole report in the body, exactly as the Copy report text', () => {
    const c = content({ title: 'Alpha – Weekly Status Report' })
    const meta = { projectName: 'Alpha Project', periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: '2026-11-08T10:00:00.000Z' }
    const { body } = draft(c, meta)
    assert.equal(body, reportToText(c, meta))
    for (const s of SECTIONS) assert.ok(body.includes(s.label.toUpperCase()), s.label)
  })

  it('keeps characters that could break a mailto: link intact (& = ? # % quotes, new lines, accents, emoji)', () => {
    const tricky = 'Cost & scope: 50% over? Use "A=B" #urgent — café 🚀\nsecond line'
    const { subject, body } = draft(content({ title: tricky, executiveSummary: tricky, risks: [tricky] }))
    assert.equal(subject, tricky)
    assert.ok(body.includes(tricky))
  })

  it('marks sample, demo and sample-copy reports as samples, and live reports as generated', () => {
    const base = { periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: '2026-11-08T10:00:00.000Z' }
    const sample = draft(content(), metaOf({ ...base, demo: true }, { name: 'P' })).body
    assert.ok(sample.includes('SAMPLE REPORT – illustrative output, not generated live'))
    assert.ok(!sample.includes('Generated:'))
    const live = draft(content(), metaOf({ ...base, source: 'ai' }, { name: 'P' })).body
    assert.ok(!live.includes('SAMPLE REPORT'))
    assert.ok(live.includes('Generated:'))
  })

  it('still shows every section for a report whose sections are empty', () => {
    const { body } = draft(content({ completedActivities: [], workInProgress: [], blockers: [], risks: [], nextSteps: [], executiveActionRequired: [] }))
    assert.ok(body.includes('Not specified in the submitted update.'))
    assert.ok(body.includes('No executive action required at this time.'))
  })

  it('produces a single link even for a very long report (any truncation is the mail app\'s)', () => {
    const many = Array.from({ length: 200 }, (_, i) => `Item number ${i} with some descriptive text`)
    const { url, body } = draft(content({ completedActivities: many }))
    assert.ok(body.includes('Item number 199'))
    assert.ok(url.length > 5000)
  })

  it('does nothing except assign the link: it never calls fetch or anything else on window', () => {
    const touched = []
    globalThis.window = new Proxy({ location: { set href(v) { assigned.push(v) } } }, { get: (t, k) => (touched.push(String(k)), t[k]) })
    emailReport(content(), {})
    assert.deepEqual([...new Set(touched)], ['location'])
  })
})
