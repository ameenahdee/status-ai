import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { statusCounts, healthSegments, recentReports, activityEvents, relativeTime, NOT_SET } from '../src/dashboard.js'
import { content } from './helpers/fixtures.mjs'

// Every figure on the Overview dashboard is worked out from saved data. Nothing is invented.

const P = (id, status, over = {}) => ({ id, name: `Project ${id}`, status, createdAt: '2026-11-01T09:00:00.000Z', ...over })
const R = (id, projectId, over = {}) => ({
  id, projectId, title: `Report ${id}`, source: 'ai', savedAt: '2026-11-05T09:00:00.000Z', updatedAt: null, projectStatusAtReport: 'On Track', content: content(), ...over,
})

describe('project counts', () => {
  it('count each project by its current confirmed status', () => {
    const c = statusCounts([P(1, 'On Track'), P(2, 'On Track'), P(3, 'At Risk'), P(4, 'Blocked'), P(5, 'Off Track'), P(6, null)])
    assert.deepEqual(c, { total: 6, 'On Track': 2, 'At Risk': 1, Blocked: 1, 'Off Track': 1, [NOT_SET]: 1 })
  })

  it('a project with no (or an unrecognised) status is "Not set", never On Track', () => {
    const c = statusCounts([P(1, null), P(2, undefined), P(3, ''), P(4, 'Green'), P(5, 'Insufficient Information')])
    assert.equal(c['On Track'], 0)
    assert.equal(c[NOT_SET], 5)
    assert.equal(c.total, 5)
  })

  it('no projects: all zero', () => {
    assert.deepEqual(statusCounts([]), { total: 0, 'On Track': 0, 'At Risk': 0, Blocked: 0, 'Off Track': 0, [NOT_SET]: 0 })
  })

  it('follow the data: a changed status changes the counts', () => {
    const before = statusCounts([P(1, 'On Track'), P(2, 'On Track')])
    const after = statusCounts([P(1, 'On Track'), P(2, 'Blocked')])
    assert.deepEqual([before['On Track'], before.Blocked], [2, 0])
    assert.deepEqual([after['On Track'], after.Blocked], [1, 1])
  })
})

describe('Project Health donut', () => {
  it('has a segment, count and percentage for each status, from real data', () => {
    const ps = [P(1, 'On Track'), P(2, 'On Track'), P(3, 'On Track'), P(4, 'At Risk'), P(5, 'At Risk'), P(6, 'Blocked')]
    const h = healthSegments(ps)
    assert.equal(h.total, 6)
    assert.deepEqual(h.segments.map((s) => [s.key, s.count, s.percent]), [['On Track', 3, 50], ['At Risk', 2, 33], ['Blocked', 1, 17]])
    assert.equal(h.segments[0].fraction, 0.5)
  })

  it('always lists On Track, At Risk and Blocked, even at zero', () => {
    const h = healthSegments([P(1, 'On Track')])
    assert.deepEqual(h.segments.map((s) => s.key), ['On Track', 'At Risk', 'Blocked'])
    assert.deepEqual(h.segments.map((s) => s.count), [1, 0, 0])
  })

  it('adds Off Track and Not set only when such projects exist, so the chart always adds up to the total', () => {
    const h = healthSegments([P(1, 'On Track'), P(2, 'Off Track'), P(3, null)])
    assert.deepEqual(h.segments.map((s) => s.key), ['On Track', 'At Risk', 'Blocked', 'Off Track', NOT_SET])
    assert.equal(h.segments.reduce((n, s) => n + s.count, 0), h.total)
    assert.ok(Math.abs(h.segments.reduce((n, s) => n + s.fraction, 0) - 1) < 1e-9)
  })

  it('no projects: nothing is invented (all zero, no fractions)', () => {
    const h = healthSegments([])
    assert.equal(h.total, 0)
    assert.ok(h.segments.every((s) => s.count === 0 && s.percent === 0 && s.fraction === 0))
  })

  it('projects without any status are all "Not set" (the ring is not presented as healthy)', () => {
    const h = healthSegments([P(1, null), P(2, null)])
    const seg = Object.fromEntries(h.segments.map((s) => [s.key, s]))
    assert.equal(seg['On Track'].count, 0)
    assert.equal(seg[NOT_SET].percent, 100)
  })

  it('legend counts equal the summary counts', () => {
    const ps = [P(1, 'On Track'), P(2, 'At Risk'), P(3, 'At Risk'), P(4, 'Blocked'), P(5, 'Off Track')]
    const c = statusCounts(ps)
    for (const s of healthSegments(ps).segments) assert.equal(s.count, c[s.key])
  })
})

describe('recent reports', () => {
  it('are the latest saved reports, newest first, limited', () => {
    const ps = [P('a', 'On Track')]
    const rs = Array.from({ length: 8 }, (_, i) => R(`r${i}`, 'a', { savedAt: `2026-11-0${i + 1}T09:00:00.000Z` }))
    const out = recentReports(rs, ps, 5)
    assert.deepEqual(out.map((x) => x.report.id), ['r7', 'r6', 'r5', 'r4', 'r3'])
    assert.equal(recentReports(rs, ps, 3).length, 3)
  })

  it('show the project name and the final PM-selected status', () => {
    const [row] = recentReports([R('r1', 'a', { projectStatusAtReport: 'Blocked' })], [P('a', 'On Track', { name: 'Payments' })])
    assert.equal(row.projectName, 'Payments')
    assert.equal(row.status, 'Blocked')
  })

  it('NEVER use the AI recommendation as the status', () => {
    const r = R('r1', 'a', { projectStatusAtReport: 'On Track', assessment: { outcome: 'Off Track', explanation: 'x', evidence: [], missingInformation: [] } })
    assert.equal(recentReports([r], [P('a', null)])[0].status, 'On Track')
    const noFinal = R('r2', 'a', { projectStatusAtReport: null, assessment: { outcome: 'Blocked', explanation: 'x', evidence: [], missingInformation: [] } })
    assert.equal(recentReports([noFinal], [P('a', null)])[0].status, null) // not recorded, never "Blocked"
  })

  it('a missing or invalid final status shows as not recorded', () => {
    for (const projectStatusAtReport of [null, undefined, '', 'Insufficient Information', 'Green']) {
      assert.equal(recentReports([R('r1', 'a', { projectStatusAtReport })], [P('a', null)])[0].status, null)
    }
  })

  it('a report whose project is missing says so instead of failing', () => {
    assert.equal(recentReports([R('r1', 'gone')], [])[0].projectName, 'Unknown project')
  })

  it('no reports: empty', () => {
    assert.deepEqual(recentReports([], [P('a', null)]), [])
  })
})

describe('recent activity', () => {
  const state = (over = {}) => ({ projects: [P('a', 'On Track', { name: 'Payments' })], reports: [], statusHistory: [], ...over })
  const titles = (events) => events.map((e) => e.title)

  it('has nothing when nothing has happened', () => {
    assert.deepEqual(activityEvents({ projects: [], reports: [], statusHistory: [] }), [])
  })

  it('lists a created project', () => {
    const [e] = activityEvents(state())
    assert.equal(e.title, 'New project created')
    assert.equal(e.detail, 'Payments')
    assert.equal(e.href, '#/projects/a')
  })

  it('lists a live report as "New report generated", linking to it', () => {
    const e = activityEvents(state({ reports: [R('r1', 'a')] })).find((x) => x.kind === 'report')
    assert.equal(e.title, 'New report generated')
    assert.equal(e.detail, 'Payments')
    assert.equal(e.href, '#/reports/r1')
  })

  it('lists a status-history entry as "Project status updated" with the new status', () => {
    const h = { id: 'h1', projectId: 'a', previousStatus: 'On Track', newStatus: 'At Risk', at: '2026-11-06T09:00:00.000Z', source: 'manual' }
    const e = activityEvents(state({ statusHistory: [h] })).find((x) => x.kind === 'status')
    assert.equal(e.title, 'Project status updated')
    assert.equal(e.detail, 'Payments → At Risk')
  })

  it('lists an edited report as "Saved report edited"', () => {
    const r = R('r1', 'a', { updatedAt: '2026-11-07T09:00:00.000Z' })
    const e = activityEvents(state({ reports: [r] })).find((x) => x.kind === 'edit')
    assert.equal(e.title, 'Saved report edited')
    assert.match(e.detail, /Report r1/)
  })

  it('a report-status edit is ONE event (not also a second edit event), with the movement', () => {
    const r = R('r1', 'a', { updatedAt: '2026-11-07T09:00:00.500Z', projectStatusAtReport: 'Blocked' })
    const h = { id: 'h1', projectId: 'a', reportId: 'r1', reportEdit: true, previousStatus: 'On Track', newStatus: 'Blocked', at: '2026-11-07T09:00:00.000Z', source: 'report' }
    const edits = activityEvents(state({ reports: [r], statusHistory: [h] }), 20).filter((x) => x.kind === 'edit')
    assert.equal(edits.length, 1)
    assert.match(edits[0].detail, /Project Health On Track → Blocked/)
  })

  it('an edit of a deleted report is still shown, without a broken link', () => {
    const h = { id: 'h1', projectId: 'a', reportId: 'gone', reportEdit: true, reportDeleted: true, previousStatus: null, newStatus: 'Blocked', at: '2026-11-07T09:00:00.000Z', source: 'report' }
    const e = activityEvents(state({ statusHistory: [h] })).find((x) => x.kind === 'edit')
    assert.match(e.detail, /A deleted report/)
    assert.match(e.detail, /not recorded → Blocked/)
    assert.equal(e.href, null)
  })

  it('a saved sample copy is a real event; demo records are never listed', () => {
    const copy = R('c1', 'a', { sampleCopy: true, demo: true, source: 'sample-copy' })
    const demoReport = R('d1', 'a', { demo: true, source: 'demo' })
    const demoProject = P('dp', 'On Track', { demo: true })
    const demoHistory = { id: 'dh', projectId: 'dp', newStatus: 'Blocked', at: '2026-11-06T09:00:00.000Z', source: 'manual', demo: true }
    const events = activityEvents(state({ projects: [P('a', 'On Track'), demoProject], reports: [copy, demoReport], statusHistory: [demoHistory] }), 20)
    assert.ok(titles(events).includes('Sample copy saved'))
    assert.ok(!events.some((e) => /demo|Report d1/i.test(e.id + e.detail) && e.kind !== 'sample'))
    assert.ok(!events.some((e) => e.id.includes('dp') || e.id.includes('dh') || e.id.includes('d1')))
  })

  it('is newest first, limited, and stable', () => {
    const rs = Array.from({ length: 6 }, (_, i) => R(`r${i}`, 'a', { savedAt: `2026-11-0${i + 1}T09:00:00.000Z` }))
    const out = activityEvents(state({ reports: rs }), 3)
    assert.equal(out.length, 3)
    assert.deepEqual(out.map((e) => e.id), ['report:r5', 'report:r4', 'report:r3'])
  })

  it('skips records with no usable time instead of showing a made-up one', () => {
    const out = activityEvents(state({ projects: [P('a', null, { createdAt: undefined })], reports: [R('r1', 'a', { savedAt: 'not a date' })] }), 20)
    assert.deepEqual(out, [])
  })

  it('never produces integration, Slack, deletion or sync events (the data model records none)', () => {
    const everything = activityEvents(state({
      reports: [R('r1', 'a', { updatedAt: '2026-11-07T09:00:00.000Z' })],
      statusHistory: [{ id: 'h1', projectId: 'a', newStatus: 'Blocked', at: '2026-11-06T09:00:00.000Z', source: 'manual' }],
    }), 50)
    assert.ok(everything.every((e) => ['project', 'report', 'sample', 'status', 'edit'].includes(e.kind)))
    assert.ok(!everything.some((e) => /slack|sync|integration|delete/i.test(`${e.title} ${e.detail}`)))
  })
})

describe('relativeTime', () => {
  const now = new Date(2026, 10, 10, 15, 0, 0) // local time, 10 Nov 2026 15:00
  const ago = (ms) => new Date(now.getTime() - ms).toISOString()
  it('reads naturally', () => {
    assert.equal(relativeTime(ago(10_000), now), 'Just now')
    assert.equal(relativeTime(ago(5 * 60_000), now), '5 min ago')
    assert.equal(relativeTime(ago(2 * 3_600_000), now), '2 hours ago')
    assert.equal(relativeTime(ago(1 * 3_600_000), now), '1 hour ago')
    assert.equal(relativeTime(new Date(2026, 10, 9, 20, 0).toISOString(), now), 'Yesterday')
    assert.equal(relativeTime(new Date(2026, 10, 7, 12, 0).toISOString(), now), '3 days ago')
  })
  it('falls back to a date for older items, and to nothing for bad input', () => {
    assert.match(relativeTime(new Date(2026, 9, 1, 12, 0).toISOString(), now), /2026/)
    assert.equal(relativeTime('nope', now), '')
    assert.equal(relativeTime(undefined, now), '')
  })
  it('a time slightly in the future (clock skew) is "Just now"', () => {
    assert.equal(relativeTime(new Date(now.getTime() + 30_000).toISOString(), now), 'Just now')
  })
})
