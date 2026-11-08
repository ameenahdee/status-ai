import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isHistoryEligible, hasUsablePeriod, historyFor, latestLiveReport, latestByPeriod, previousReportFor } from '../src/history.js'
import { content } from './helpers/fixtures.mjs'

// Pure tests: hand-built states, no storage. The rules being checked:
//  same project only; ordered by reporting-period END; demo and sample copies excluded; duplicate and overlapping
//  periods handled explicitly; back-filled reports are never silently "the latest"; nothing looks at report content.

const rep = (id, periodStart, periodEnd, savedAt, over = {}) => ({
  id, projectId: 'p1', title: id, originalUpdate: `update ${id}`, periodStart, periodEnd,
  generatedAt: null, savedAt, updatedAt: null, source: 'ai', content: content(), ...over,
})
const st = (...reports) => ({ projects: [], reports, statusHistory: [] })
const ids = (list) => list.map((x) => x.report?.id ?? x.id)

// A tidy weekly history: W1, W2, W3, saved in order.
const W1 = () => rep('w1', '2026-10-01', '2026-10-07', '2026-10-08T09:00:00Z')
const W2 = () => rep('w2', '2026-10-08', '2026-10-14', '2026-10-15T09:00:00Z')
const W3 = () => rep('w3', '2026-10-15', '2026-10-21', '2026-10-22T09:00:00Z')

describe('what counts as project history', () => {
  it('includes live reports and excludes demo reports and saved sample copies', () => {
    assert.equal(isHistoryEligible(rep('a', '2026-10-01', '2026-10-07', 's')), true)
    assert.equal(isHistoryEligible(rep('b', '2026-10-01', '2026-10-07', 's', { demo: true, source: 'demo' })), false)
    assert.equal(isHistoryEligible(rep('c', '2026-10-01', '2026-10-07', 's', { demo: true, sampleCopy: true, source: 'sample-copy' })), false)
  })

  it('needs a real period end, and a start that is not after it', () => {
    assert.equal(hasUsablePeriod(rep('a', '2026-10-01', '2026-10-07', 's')), true)
    assert.equal(hasUsablePeriod(rep('a', undefined, '2026-10-07', 's')), true, 'start is optional')
    assert.equal(hasUsablePeriod(rep('a', '2026-10-08', '2026-10-07', 's')), false, 'start after end')
    assert.equal(hasUsablePeriod(rep('a', '2026-10-01', undefined, 's')), false, 'no end')
    assert.equal(hasUsablePeriod(rep('a', '2026-10-01', 'soon', 's')), false, 'end is not a date')
  })
})

describe('historyFor: chronological order comes from the period end', () => {
  it('orders oldest to newest by period end, whatever the save order or array order', () => {
    const state = st(W3(), W1(), W2())
    assert.deepEqual(ids(historyFor(state, 'p1').entries), ['w1', 'w2', 'w3'])
  })

  it('does not use save time: a report saved first can still be the latest', () => {
    const early = rep('late-period-saved-first', '2026-11-01', '2026-11-07', '2026-10-01T00:00:00Z')
    const late = rep('early-period-saved-last', '2026-10-01', '2026-10-07', '2026-12-01T00:00:00Z')
    assert.deepEqual(ids(historyFor(st(early, late), 'p1').entries), ['early-period-saved-last', 'late-period-saved-first'])
    assert.equal(historyFor(st(early, late), 'p1').latest.id, 'late-period-saved-first')
  })

  it('only includes the requested project', () => {
    const other = rep('x', '2026-10-01', '2026-10-07', 's', { projectId: 'p2' })
    assert.deepEqual(ids(historyFor(st(W1(), other), 'p1').entries), ['w1'])
  })

  it('excludes demo reports and sample copies, even when they are newer or closer', () => {
    const demo = rep('demo', '2026-10-22', '2026-10-28', '2026-10-29T00:00:00Z', { demo: true, source: 'demo' })
    const copy = rep('copy', '2026-10-22', '2026-10-28', '2026-10-30T00:00:00Z', { demo: true, sampleCopy: true, source: 'sample-copy' })
    const h = historyFor(st(W1(), W2(), demo, copy), 'p1')
    assert.deepEqual(ids(h.entries), ['w1', 'w2'])
    assert.equal(h.latest.id, 'w2')
  })

  it('lists reports it cannot place in time separately, instead of guessing where they belong', () => {
    const noPeriod = rep('no-period', undefined, undefined, '2026-10-09T00:00:00Z')
    const h = historyFor(st(W1(), noPeriod), 'p1')
    assert.deepEqual(ids(h.entries), ['w1'])
    assert.deepEqual(h.excluded, ['no-period'])
  })

  it('breaks ties deterministically (period end, then start, then save time, then id)', () => {
    const a = rep('a', '2026-10-05', '2026-10-07', '2026-10-08T00:00:00Z')
    const b = rep('b', '2026-10-01', '2026-10-07', '2026-10-08T00:00:00Z')
    const same = rep('c', '2026-10-05', '2026-10-07', '2026-10-09T00:00:00Z')
    const a1 = ids(historyFor(st(a, b, same), 'p1').entries)
    const a2 = ids(historyFor(st(same, b, a), 'p1').entries)
    assert.deepEqual(a1, a2)
    assert.deepEqual(a1, ['b', 'a', 'c'])
  })

  it('returns an empty history for a project with no reports', () => {
    assert.deepEqual(historyFor(st(), 'p1'), { entries: [], latest: null, excluded: [] })
  })

  it('does not modify the state it reads', () => {
    const state = st(W3(), W1(), W2())
    const before = JSON.stringify(state)
    historyFor(state, 'p1')
    previousReportFor(state, { id: 'w3' })
    assert.equal(JSON.stringify(state), before)
  })
})

describe('duplicate, overlapping and back-filled periods are flagged', () => {
  it('flags exact duplicate periods on each report involved', () => {
    const dup = rep('w2-again', '2026-10-08', '2026-10-14', '2026-10-16T00:00:00Z')
    const h = historyFor(st(W1(), W2(), dup), 'p1')
    const flags = Object.fromEntries(h.entries.map((e) => [e.report.id, e.flags]))
    assert.deepEqual(flags.w2.duplicatePeriodOf, ['w2-again'])
    assert.deepEqual(flags['w2-again'].duplicatePeriodOf, ['w2'])
    assert.deepEqual(flags.w1.duplicatePeriodOf, [])
  })

  it('flags overlapping (but not identical) periods', () => {
    const overlap = rep('fortnight', '2026-10-01', '2026-10-14', '2026-10-15T00:00:00Z')
    const flags = Object.fromEntries(historyFor(st(W1(), W2(), overlap), 'p1').entries.map((e) => [e.report.id, e.flags]))
    assert.deepEqual(flags.fortnight.overlaps.sort(), ['w1', 'w2'])
    assert.deepEqual(flags.w1.overlaps, ['fortnight'])
  })

  it('does not call back-to-back periods overlapping', () => {
    const flags = historyFor(st(W1(), W2()), 'p1').entries.map((e) => e.flags.overlaps)
    assert.deepEqual(flags, [[], []])
  })

  it('flags a back-filled report: an earlier period saved after a later one', () => {
    const backfill = rep('w0', '2026-09-24', '2026-09-30', '2026-10-25T00:00:00Z') // saved last, covers the earliest week
    const flags = Object.fromEntries(historyFor(st(W1(), W2(), W3(), backfill), 'p1').entries.map((e) => [e.report.id, e.flags]))
    assert.equal(flags.w0.backFilled, true)
    assert.equal(flags.w1.backFilled, false)
    assert.equal(flags.w3.backFilled, false)
  })

  it('never treats a back-filled report as the latest, even though it was saved most recently', () => {
    const backfill = rep('w0', '2026-09-24', '2026-09-30', '2026-12-31T00:00:00Z')
    assert.equal(latestLiveReport(st(W1(), W2(), W3(), backfill), 'p1').id, 'w3')
    assert.equal(historyFor(st(W1(), W2(), W3(), backfill), 'p1').latest.id, 'w3')
  })
})

describe('latestByPeriod (used to show a project\'s latest report)', () => {
  it('chooses by period end, not by most recently saved', () => {
    const backfill = rep('w0', '2026-09-24', '2026-09-30', '2026-12-31T00:00:00Z')
    assert.equal(latestByPeriod([W1(), W2(), backfill]).id, 'w2')
  })

  it('includes whatever it is given (demo reports are fine for display)', () => {
    const demo = rep('demo', '2026-10-22', '2026-10-28', 's', { demo: true, source: 'demo' })
    assert.equal(latestByPeriod([W1(), demo]).id, 'demo')
  })

  it('falls back to the most recently saved only when no report has a usable period', () => {
    const a = rep('a', undefined, undefined, '2026-10-01T00:00:00Z')
    const b = rep('b', undefined, undefined, '2026-10-02T00:00:00Z')
    assert.equal(latestByPeriod([a, b]).id, 'b')
  })

  it('returns null for no reports', () => {
    assert.equal(latestByPeriod([]), null)
  })
})

describe('previousReportFor', () => {
  it('finds the report for the period before, by period end', () => {
    const r = previousReportFor(st(W1(), W2(), W3()), { id: 'w3' })
    assert.equal(r.status, 'found')
    assert.equal(r.report.id, 'w2')
    assert.equal(r.needsReview, false)
  })

  it('says there is none for the very first report, so comparison must be reported as unavailable', () => {
    const r = previousReportFor(st(W1(), W2()), { id: 'w1' })
    assert.equal(r.status, 'none')
    assert.equal(r.report, null)
    assert.equal(r.reason, 'no-earlier-report')
  })

  it('works for a report that has not been saved yet', () => {
    const r = previousReportFor(st(W1(), W2()), { projectId: 'p1', periodStart: '2026-10-15', periodEnd: '2026-10-21' })
    assert.equal(r.report.id, 'w2')
  })

  it('compares only within the same project', () => {
    const other = rep('x', '2026-10-08', '2026-10-14', 's', { projectId: 'p2' })
    const r = previousReportFor(st(W1(), other, W3()), { id: 'w3' })
    assert.equal(r.report.id, 'w1')
  })

  it('never picks a demo report or a saved sample copy, even if it is the closest earlier period', () => {
    const demo = rep('demo', '2026-10-08', '2026-10-14', '2026-10-15T00:00:00Z', { demo: true, source: 'demo' })
    const copy = rep('copy', '2026-10-08', '2026-10-14', '2026-10-16T00:00:00Z', { demo: true, sampleCopy: true, source: 'sample-copy' })
    assert.equal(previousReportFor(st(W1(), demo, copy, W3()), { id: 'w3' }).report.id, 'w1')
  })

  it('treats a demo or sample report as unavailable to compare at all', () => {
    const demo = rep('demo', '2026-10-08', '2026-10-14', 's', { demo: true, source: 'demo' })
    const r = previousReportFor(st(W1(), demo), { id: 'demo' })
    assert.deepEqual([r.status, r.reason, r.report], ['unavailable', 'not-live-report', null])
  })

  it('treats a report with no usable period as unavailable instead of guessing', () => {
    const r = previousReportFor(st(W1()), { projectId: 'p1', periodStart: '2026-10-01', periodEnd: undefined })
    assert.deepEqual([r.status, r.reason], ['unavailable', 'no-usable-period'])
  })

  it('treats a target with no project as unavailable', () => {
    assert.equal(previousReportFor(st(W1()), { periodEnd: '2026-10-07' }).status, 'unavailable')
  })

  it('does not choose a stored report that has no usable period as "previous"', () => {
    const noPeriod = rep('nop', undefined, undefined, '2026-10-09T00:00:00Z')
    assert.equal(previousReportFor(st(W1(), noPeriod, W3()), { id: 'w3' }).report.id, 'w1')
  })

  describe('duplicate periods', () => {
    it('collapses duplicates of the previous period to the most recently saved one, and flags it for review', () => {
      const w2again = rep('w2-again', '2026-10-08', '2026-10-14', '2026-10-20T00:00:00Z')
      const r = previousReportFor(st(W1(), W2(), w2again, W3()), { id: 'w3' })
      assert.equal(r.report.id, 'w2-again')
      assert.deepEqual(r.flags.duplicatePeriods, ['w2'])
      assert.equal(r.needsReview, true)
    })

    it('is stable whichever copy was listed first', () => {
      const w2again = rep('w2-again', '2026-10-08', '2026-10-14', '2026-10-20T00:00:00Z')
      assert.equal(previousReportFor(st(w2again, W3(), W2()), { id: 'w3' }).report.id, 'w2-again')
    })

    it('never offers a report for the same period as the one being compared', () => {
      const w3again = rep('w3-again', '2026-10-15', '2026-10-21', '2026-10-23T00:00:00Z')
      const r = previousReportFor(st(W1(), W2(), W3(), w3again), { id: 'w3-again' })
      assert.equal(r.report.id, 'w2', 'the earlier period, not its own duplicate')
      assert.deepEqual(r.flags.duplicatePeriods, ['w3'])
      assert.equal(r.needsReview, true)
    })
  })

  describe('overlapping periods', () => {
    it('flags a previous report whose period overlaps the one being compared', () => {
      const overlapping = rep('ov', '2026-10-10', '2026-10-17', '2026-10-18T00:00:00Z')
      const r = previousReportFor(st(W1(), overlapping, W3()), { id: 'w3' })
      assert.equal(r.report.id, 'ov')
      assert.equal(r.flags.overlapsPrevious, true)
      assert.equal(r.needsReview, true)
    })

    it('flags reports that share a period end but start on different days, and picks the narrower window deterministically', () => {
      const weekly = rep('weekly', '2026-10-15', '2026-10-21', '2026-10-22T00:00:00Z')
      const fortnightly = rep('fortnightly', '2026-10-08', '2026-10-21', '2026-10-22T00:00:00Z')
      const next = rep('next', '2026-10-22', '2026-10-28', '2026-10-29T00:00:00Z')
      const r = previousReportFor(st(fortnightly, weekly, next), { id: 'next' })
      assert.equal(r.report.id, 'weekly')
      assert.deepEqual(r.flags.sharedEndDate, ['fortnightly'])
      assert.equal(r.needsReview, true)
    })
  })

  describe('back-filled reports', () => {
    it('does not treat a back-filled report as the previous report for later periods just because it is newest saved', () => {
      const backfill = rep('w0', '2026-09-24', '2026-09-30', '2026-12-31T00:00:00Z')
      assert.equal(previousReportFor(st(W1(), W2(), backfill, W3()), { id: 'w3' }).report.id, 'w2')
    })

    it('finds the real predecessor of a back-filled report, flags it, and does not use a later report', () => {
      const backfill = rep('w1b', '2026-10-01', '2026-10-07', '2026-12-31T00:00:00Z')
      const earlier = rep('w0', '2026-09-24', '2026-09-30', '2026-09-30T00:00:00Z')
      const r = previousReportFor(st(earlier, W2(), W3(), backfill), { id: 'w1b' })
      assert.equal(r.report.id, 'w0')
      assert.equal(r.flags.targetIsBackFilled, true)
      assert.equal(r.needsReview, true)
    })

    it('flags a new, unsaved report whose period is earlier than reports that already exist', () => {
      const r = previousReportFor(st(W1(), W2(), W3()), { projectId: 'p1', periodStart: '2026-10-08', periodEnd: '2026-10-14', id: undefined })
      assert.equal(r.flags.targetIsBackFilled, true)
    })

    it('does not flag the newest period as back-filled', () => {
      assert.equal(previousReportFor(st(W1(), W2(), W3()), { id: 'w3' }).flags.targetIsBackFilled, false)
    })
  })

  describe('content is never consulted', () => {
    it('chooses the same report whatever the reports say, so a missing item can never imply "resolved"', () => {
      const emptyOne = { ...W2(), content: content({ blockers: [], risks: [], nextSteps: [] }) }
      const richOne = { ...W2(), content: content({ blockers: ['b1', 'b2', 'b3'] }) }
      assert.equal(previousReportFor(st(W1(), emptyOne, W3()), { id: 'w3' }).report.id, 'w2')
      assert.equal(previousReportFor(st(W1(), richOne, W3()), { id: 'w3' }).report.id, 'w2')
    })

    it('returns only a reference to the earlier report, with no comparison of any kind', () => {
      const r = previousReportFor(st(W1(), W2()), { id: 'w2' })
      assert.deepEqual(Object.keys(r).sort(), ['flags', 'needsReview', 'reason', 'report', 'status'])
    })

    it('keeps the original update and the AI output reachable from the chosen report, so nothing is lost for comparison', () => {
      const r = previousReportFor(st({ ...W1(), generatedContent: content({ executiveSummary: 'AI original' }) }, W2()), { id: 'w2' })
      assert.equal(r.report.originalUpdate, 'update w1')
      assert.equal(r.report.generatedContent.executiveSummary, 'AI original')
    })
  })
})
