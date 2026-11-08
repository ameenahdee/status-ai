import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter, createDailyCap, positiveInt } from '../server/limits.js'

describe('per-IP rate limiter', () => {
  it('allows 8 requests in a minute and blocks the 9th', () => {
    const l = createRateLimiter({ max: 8, windowMs: 60_000 })
    for (let i = 0; i < 8; i++) assert.equal(l.check('1.1.1.1', 1_000_000 + i), false)
    assert.equal(l.check('1.1.1.1', 1_000_009), true)
  })

  it('counts each IP separately', () => {
    const l = createRateLimiter({ max: 2, windowMs: 60_000 })
    l.check('a', 0)
    l.check('a', 1)
    assert.equal(l.check('a', 2), true)
    assert.equal(l.check('b', 3), false)
  })

  it('lets an IP back in once the window has passed', () => {
    const l = createRateLimiter({ max: 2, windowMs: 60_000 })
    l.check('a', 0)
    l.check('a', 1)
    assert.equal(l.check('a', 2), true)
    assert.equal(l.check('a', 61_000), false)
  })

  it('prunes idle IPs so memory cannot grow without bound, keeping active ones', () => {
    const l = createRateLimiter({ max: 8, windowMs: 60_000 })
    for (let i = 0; i < 1000; i++) l.check(`ip-${i}`, 0)
    l.check('active', 100_000)
    assert.equal(l.size, 1001)
    l.prune(100_001)
    assert.equal(l.size, 1)
    assert.equal(l.check('active', 100_002), false)
  })

  it('prunes safely when empty', () => {
    const l = createRateLimiter()
    l.prune()
    assert.equal(l.size, 0)
  })
})

describe('global daily cap', () => {
  it('allows exactly the cap, then refuses', () => {
    const c = createDailyCap(3)
    const t = Date.UTC(2026, 10, 7, 10)
    assert.deepEqual([c.take(t), c.take(t), c.take(t), c.take(t), c.take(t)], [true, true, true, false, false])
    assert.equal(c.used, 3)
  })

  it('resets at the UTC day boundary', () => {
    const c = createDailyCap(1)
    assert.equal(c.take(Date.UTC(2026, 10, 7, 23, 59, 59)), true)
    assert.equal(c.take(Date.UTC(2026, 10, 7, 23, 59, 59)), false)
    assert.equal(c.take(Date.UTC(2026, 10, 8, 0, 0, 0)), true)
  })
})

describe('positiveInt (environment parsing)', () => {
  it('accepts positive integers and falls back for everything else', () => {
    assert.equal(positiveInt('50', 200), 50)
    for (const bad of [undefined, '', '0', '-5', 'abc']) assert.equal(positiveInt(bad, 200), 200, String(bad))
  })
})
