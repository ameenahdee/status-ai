import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, '../../server/index.js')
const STUB = pathToFileURL(path.join(here, 'genai-stub.mjs')).href

// Environment the app reads. Cleared before every test server so nothing leaks in from the
// developer's machine (real keys, models, flags).
const APP_ENV = ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_TIMEOUT_MS', 'AI_PROVIDER', 'LIVE_GENERATION_ENABLED', 'DAILY_REQUEST_CAP', 'NODE_ENV', 'PORT', 'TEST_GENAI_MODE']

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

/**
 * Starts the real server (server/index.js) as a child process on a free port.
 *  - the Gemini API is replaced by a stub (see genai-stub.mjs); no real network call can happen
 *  - runs in an empty temp folder, so the developer's real .env is never read
 *  - uses a fake API key
 * Returns { url, requests, logs, request(path, opts), stop() }.
 */
export async function startServer({ mode = 'ok', env = {} } = {}) {
  const port = await freePort()
  const cwd = mkdtempSync(path.join(tmpdir(), 'status-ai-test-'))
  const childEnv = { ...process.env }
  for (const k of APP_ENV) delete childEnv[k]
  Object.assign(childEnv, { PORT: String(port), GEMINI_API_KEY: 'test-key-not-a-real-key', GEMINI_MODEL: 'test-model', TEST_GENAI_MODE: mode }, env)
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k]

  const child = spawn(process.execPath, ['--import', STUB, SERVER], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const requests = [] // what the server tried to send to "Gemini" (parsed [stub] lines)
  const logs = [] // everything else the server printed
  const onData = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith('[stub] ')) requests.push(JSON.parse(line.slice(7)))
      else logs.push(line)
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  const exited = new Promise((resolve) => child.once('exit', resolve))

  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`test server exited early:\n${logs.join('\n')}`)
    try {
      if ((await fetch(`${url}/api/health`)).ok) break
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill()
      throw new Error(`test server did not start:\n${logs.join('\n')}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  let ipCounter = 0
  return {
    url,
    requests,
    logs,
    // Each call uses its own client IP unless one is given, so the per-IP limiter never interferes.
    // timeoutMs makes a hung server fail the test quickly instead of hanging the whole suite.
    async request(pathname, { method = 'GET', json, raw, headers = {}, ip, timeoutMs = 20_000 } = {}) {
      const res = await fetch(url + pathname, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'X-Forwarded-For': ip ?? `10.${Math.floor(++ipCounter / 250)}.0.${(ipCounter % 250) + 1}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: raw ?? (json !== undefined ? JSON.stringify(json) : undefined),
      })
      const text = await res.text()
      let body = null
      try {
        body = JSON.parse(text)
      } catch {
        /* not JSON */
      }
      return { status: res.status, headers: res.headers, text, body }
    },
    async stop() {
      child.kill()
      await exited
      rmSync(cwd, { recursive: true, force: true })
      // The stub blocks every network call except its own fake Gemini endpoint. If the app ever
      // tried one, fail loudly instead of letting a real call slip through unnoticed.
      const blocked = requests.filter((r) => r.blocked)
      if (blocked.length) throw new Error(`the server attempted unexpected network calls: ${blocked.map((r) => r.blocked).join(', ')}`)
    },
  }
}

export const validBody = (over = {}) => ({
  updates: 'Finished the login API. Dashboard about 60% done. Payment integration blocked.',
  projectName: 'Alpha Project',
  projectDescription: 'Replace the legacy invoicing tool so finance can close month-end faster.',
  audience: 'Steering committee',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-07',
  ...over,
})
