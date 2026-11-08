import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SECTIONS, NOT_SPECIFIED, NO_ACTION, itemsOf, isEmptySection, toLines, fromLines,
  fmtPeriod, fmtDate, todayStr, dateLabel, reportStamp, metaLines, reportToText,
} from '../src/sections.js'
import { metaOf } from '../src/exporters.js'
import { content, SECTION_KEYS } from './helpers/fixtures.mjs'

const section = (key) => SECTIONS.find((s) => s.key === key)

describe('the seven-section structure', () => {
  it('has exactly the seven agreed sections, in order', () => {
    assert.deepEqual(SECTIONS.map((s) => s.label), [
      'Executive Summary', 'Completed Activities', 'Work in Progress', 'Blockers', 'Risks', 'Next Steps', 'Executive Action Required',
    ])
    assert.deepEqual(SECTIONS.map((s) => s.key), SECTION_KEYS)
  })

  it('treats only the Executive Summary as free text; the rest are lists', () => {
    assert.deepEqual(SECTIONS.filter((s) => s.text).map((s) => s.key), ['executiveSummary'])
  })
})

describe('itemsOf: all seven sections always show something', () => {
  it('returns real items when there are some', () => {
    assert.deepEqual(itemsOf(content({ risks: ['a', 'b'] }), section('risks')), ['a', 'b'])
  })

  it('falls back to "Not specified in the submitted update." for empty lists and summary', () => {
    assert.deepEqual(itemsOf(content({ blockers: [] }), section('blockers')), [NOT_SPECIFIED])
    assert.deepEqual(itemsOf(content({ executiveSummary: '   ' }), section('executiveSummary')), [NOT_SPECIFIED])
    assert.deepEqual(itemsOf({}, section('nextSteps')), [NOT_SPECIFIED])
  })

  it('uses its own wording when no executive action is identified', () => {
    assert.deepEqual(itemsOf(content({ executiveActionRequired: [] }), section('executiveActionRequired')), [NO_ACTION])
    assert.equal(NO_ACTION, 'No executive action required at this time.')
    assert.equal(NOT_SPECIFIED, 'Not specified in the submitted update.')
  })

  it('drops blank items rather than showing them', () => {
    assert.deepEqual(itemsOf(content({ risks: ['', 'real', null] }), section('risks')), ['real'])
  })

  it('reports emptiness separately from the fallback text', () => {
    assert.equal(isEmptySection(content({ risks: [] }), section('risks')), true)
    assert.equal(isEmptySection(content({ risks: ['x'] }), section('risks')), false)
    assert.equal(isEmptySection(content({ executiveSummary: '' }), section('executiveSummary')), true)
  })
})

describe('editing helpers', () => {
  it('turns list items into one-per-line text and back', () => {
    assert.equal(toLines(['a', 'b']), 'a\nb')
    assert.deepEqual(fromLines('a\nb'), ['a', 'b'])
    assert.equal(toLines(undefined), '')
  })

  it('strips bullet characters, trims and drops blank lines when parsing', () => {
    assert.deepEqual(fromLines('- one\n  • two  \n* three\n\n   \nfour'), ['one', 'two', 'three', 'four'])
  })
})

describe('dates', () => {
  it('formats an empty period and empty date safely', () => {
    assert.equal(fmtPeriod('', ''), 'Not set')
    assert.equal(fmtDate(''), '—')
  })

  it('formats a period with both ends and returns today as YYYY-MM-DD', () => {
    assert.match(fmtPeriod('2026-11-01', '2026-11-07'), /2026.*–.*2026/)
    assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('sample, demo and live reports are clearly distinguished', () => {
  const live = { source: 'ai', periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: '2026-11-08T10:00:00.000Z' }
  const demo = { ...live, source: 'demo', demo: true }
  const copy = { ...live, source: 'sample-copy', demo: true, sampleCopy: true }

  it('labels the date "Generated" only for live AI reports', () => {
    assert.equal(dateLabel(live), 'Generated')
    assert.equal(dateLabel(demo), 'Dated')
    assert.equal(dateLabel(copy), 'Saved')
  })

  it('marks demo reports and sample copies as sample when exporting, but not live reports', () => {
    assert.equal(metaOf(live, { name: 'P' }).isSample, false)
    assert.equal(metaOf(demo, { name: 'P' }).isSample, true)
    assert.equal(metaOf(copy, { name: 'P' }).isSample, true)
  })

  it('exports a live report with a "Generated:" line and no sample marker', () => {
    const text = reportToText(content(), metaOf(live, { name: 'P' }))
    assert.ok(text.includes('Generated:'))
    assert.ok(!/SAMPLE REPORT/.test(text))
  })

  it('exports a sample as "illustrative output, not generated live" and never as "Generated"', () => {
    for (const rec of [demo, copy]) {
      const text = reportToText(content(), metaOf(rec, { name: 'P' }))
      assert.ok(text.includes('SAMPLE REPORT – illustrative output, not generated live'))
      assert.ok(!text.includes('Generated:'))
    }
  })

  it('includes the project and reporting period in the export header', () => {
    const lines = metaLines(metaOf(live, { name: 'Alpha Project' }))
    assert.ok(lines.includes('Project: Alpha Project'))
    assert.ok(lines.some((l) => l.startsWith('Reporting period:')))
  })
})

describe('which date a report shows (reportStamp)', () => {
  const live = { source: 'ai', generatedAt: '2026-11-08T08:30:00.000Z', savedAt: '2026-11-10T09:00:00.000Z' }

  it('calls it "Generated" only when the AI generation time was really recorded', () => {
    assert.deepEqual(reportStamp(live), { label: 'Generated', iso: '2026-11-08T08:30:00.000Z' })
  })

  it('shows the save time, labelled "Saved", when the generation time is unknown (older reports), never a guess', () => {
    assert.deepEqual(reportStamp({ ...live, generatedAt: null }), { label: 'Saved', iso: '2026-11-10T09:00:00.000Z' })
  })

  it('never calls a sample copy or demo report "Generated"', () => {
    assert.deepEqual(reportStamp({ demo: true, sampleCopy: true, generatedAt: null, savedAt: 's' }), { label: 'Saved', iso: 's' })
    assert.deepEqual(reportStamp({ demo: true, generatedAt: null, savedAt: 'd' }), { label: 'Dated', iso: 'd' })
    assert.equal(reportStamp({ demo: true, generatedAt: '2026-11-08T08:30:00.000Z', savedAt: 'd' }).label, 'Dated')
  })

  it('exports "Saved:" rather than "Generated:" when only the save time is known', () => {
    const lines = metaLines({ periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: null, savedAt: '2026-11-10T09:00:00.000Z' })
    assert.ok(lines.some((l) => l.startsWith('Saved:')))
    assert.ok(!lines.some((l) => l.startsWith('Generated:')))
  })

  it('exports "Generated:" when the AI generation time is known, and no "Saved:" line', () => {
    const lines = metaLines({ periodStart: '2026-11-01', periodEnd: '2026-11-07', generatedAt: live.generatedAt, savedAt: live.savedAt })
    assert.ok(lines.some((l) => l.startsWith('Generated:')))
    assert.ok(!lines.some((l) => l.startsWith('Saved:')))
  })

  it('passes the save time through to exports', () => {
    assert.equal(metaOf({ ...live, periodStart: 'a', periodEnd: 'b' }, { name: 'P' }).savedAt, live.savedAt)
  })
})

describe('reportToText', () => {
  it('writes the title and all seven headings, in order', () => {
    const text = reportToText(content({ title: 'My Title' }), {})
    assert.ok(text.startsWith('My Title'))
    const positions = SECTIONS.map((s) => text.indexOf(s.label.toUpperCase()))
    assert.ok(positions.every((p) => p >= 0), 'every heading present')
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'headings in order')
  })

  it('lists items as bullets and still shows empty sections with their fallback text', () => {
    const text = reportToText(content({ risks: [], executiveActionRequired: [] }), {})
    assert.ok(text.includes('- Did a thing'))
    assert.ok(text.includes(`- ${NOT_SPECIFIED}`))
    assert.ok(text.includes(`- ${NO_ACTION}`))
  })
})
