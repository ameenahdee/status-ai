import 'dotenv/config'
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { getProvider } from './providers/index.js'

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '50kb' }))

let provider
let providerError
try {
  provider = getProvider()
} catch (e) {
  providerError = e.message
  console.error(providerError)
}

// Simple in-memory per-IP rate limit (public app, no accounts)
const hits = new Map()
function limited(ip) {
  const now = Date.now()
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000)
  recent.push(now)
  hits.set(ip, recent)
  return recent.length > 8
}

app.get('/api/health', (_req, res) => res.json({ ok: !!provider, error: providerError }))

app.post('/api/report', async (req, res) => {
  const { updates, projectName, projectDescription, audience, periodStart, periodEnd } = req.body || {}
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  if (typeof updates !== 'string' || updates.trim().length < 10)
    return res.status(400).json({ error: 'Please enter a few lines of project updates.' })
  if (updates.length > 12000)
    return res.status(400).json({ error: 'Updates are too long (max 12,000 characters).' })
  if (!provider) return res.status(503).json({ error: 'AI service is not configured.' })
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many requests. Please wait a minute.' })
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
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const port = process.env.PORT || 3001
app.listen(port, () => console.log(`Status AI server on :${port}`))
