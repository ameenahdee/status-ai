import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getProvider } from './providers/index.js'
import { createRateLimiter, createDailyCap, positiveInt } from './limits.js'

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)

// Basic security headers. CSP allows only this origin plus Google Fonts (the app's only external assets).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000') // HTTPS only (via trust proxy)
  next()
})
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '50kb' }))

let provider
let providerError
try {
  provider = getProvider()
} catch (e) {
  providerError = e.message
  console.error(providerError)
}

// Per-IP limit (8/min) plus a global daily cap on live AI generations (public app, no accounts).
const ipLimiter = createRateLimiter({ max: 8, windowMs: 60_000 })
setInterval(() => ipLimiter.prune(), 60_000).unref()
const dailyCap = createDailyCap(positiveInt(process.env.DAILY_REQUEST_CAP, 200))

// Live generation sends visitor text to Google. In production it must be switched on explicitly
// (LIVE_GENERATION_ENABLED=true); outside production it is on by default for local development.
const liveEnabled = process.env.LIVE_GENERATION_ENABLED
  ? ['1', 'true', 'yes'].includes(process.env.LIVE_GENERATION_ENABLED.toLowerCase())
  : process.env.NODE_ENV !== 'production'

app.get('/api/health', (_req, res) => res.json({ ok: !!provider, error: providerError }))

app.post('/api/report', async (req, res) => {
  const { updates, projectName, projectDescription, audience, periodStart, periodEnd } = req.body || {}
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (typeof updates !== 'string' || updates.trim().length < 10)
    return res.status(400).json({ error: 'Please enter a few lines of project updates.' })
  if (updates.length > 12000)
    return res.status(400).json({ error: 'Updates are too long (max 12,000 characters).' })
  if (!liveEnabled)
    return res.status(503).json({
      code: 'DISABLED',
      error: 'Live report generation is not enabled in this demo. You can still try a sample generation, explore the sample report and the demo workspace.',
    })
  if (!provider) return res.status(503).json({ error: 'AI service is not configured.' })
  if (ipLimiter.check(req.ip)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' })
  if (!dailyCap.take())
    return res.status(429).json({
      error: 'The daily limit for live report generation in this demo has been reached. Please try again tomorrow, or explore the sample report.',
    })
  try {
    const report = await provider.generateReport({
      updates: updates.trim(),
      projectName: String(projectName || '').slice(0, 120),
      projectDescription: String(projectDescription || '').trim().slice(0, 500),
      audience: String(audience || '').slice(0, 120),
      periodStart: isDate(periodStart) ? periodStart : '',
      periodEnd: isDate(periodEnd) ? periodEnd : '',
    })
    // Original submission is returned untouched alongside the generated report
    res.json({ original: updates, report })
  } catch (e) {
    console.error('generate failed:', e.code || e.status || '', e.message)
    if (res.headersSent) return
    if (e.code === 'TIMEOUT')
      return res.status(504).json({ error: 'The AI service took too long to respond. Please try again, or explore the sample report.' })
    const msg = `${e.status ?? ''} ${e.message}`
    if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg))
      return res.status(429).json({ error: 'The available AI usage limit has been reached. Please try again later.' })
    if (/503|UNAVAILABLE|overloaded/i.test(msg))
      return res.status(503).json({ error: 'Our AI service is temporarily busy. Please try again shortly, or explore the sample report.' })
    res.status(502).json({ error: 'We could not generate the report this time. Please try again, or explore the sample report.' })
  }
})

// Last-resort handlers: always answer with JSON and keep the process alive
app.use((err, _req, res, _next) => {
  console.error('unhandled route error:', err.message)
  if (!res.headersSent) res.status(err.status || 500).json({ error: 'Unexpected server error. Please try again.' })
})
process.on('unhandledRejection', (r) => console.error('unhandledRejection:', r?.message || r))
process.on('uncaughtException', (e) => console.error('uncaughtException:', e.message))

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist')
if (existsSync(dist)) {
  // Hashed build assets never change, so cache them hard; HTML is always revalidated.
  app.use(
    express.static(dist, {
      setHeaders(res, file) {
        if (path.relative(dist, file).split(path.sep)[0] === 'assets')
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        else if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache')
        else res.setHeader('Cache-Control', 'public, max-age=86400')
      },
    }),
  )
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`Status AI server on :${port}`))
