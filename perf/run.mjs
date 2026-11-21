// npm run perf: build the library, serve perf.html with Vite, run it in headless Chrome (the one
// installed - nothing is downloaded), and save the results to perf/results/<date>-<commit>.json for
// comparing across commits. Set CHROME to the browser's path if it isn't found.
//   npm run perf -- glass labels     only those scenes, by key (bench.js SCENES) - saved as
//                                    <date>-<commit>-glass+labels.json, not over a full run's file
//   npm run perf -- --pictures       also a PNG of each scene as each library drew it, in
//                                    perf/results/pictures/ - to see both draw the same thing
//   npm run perf -- --source         phoria2 from src/, as the dev server serves it, not built
//
// phoria2 is timed as apps get it: built (perf/results/build, in about a second) with its chunks -
// shadows, effects, bloom, picking - each one file, its GLSL minified. Served from src/, a chunk
// arrives as a chain of modules, one after another, and every "build + first frame" that loads one
// pays for it; three.js is pre-bundled by Vite either way. The perf page opened with `npm run dev`
// uses src/.
import { build, createServer } from 'vite'
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const chrome = CANDIDATES.find((p) => p && existsSync(p))
if (!chrome) {
  console.error('No Chrome found - set CHROME to its path')
  process.exit(1)
}

const args = process.argv.slice(2)
const pictures = args.includes('--pictures')
const fromSource = args.includes('--source')
const scenes = args.filter((a) => !a.startsWith('--'))

// the library built, and phoria2 and each of its sub-paths (package.json's exports) pointed at it
const built = join(root, 'perf', 'results', 'build')
/** @type {{ find: RegExp, replacement: string }[]} */
const alias = []
if (!fromSource) {
  await build({ root, configFile: join(root, 'vite.config.js'), logLevel: 'error', build: { outDir: built, emptyOutDir: true } })
  const exports = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).exports
  for (const [path, target] of Object.entries(exports)) {
    if (typeof target !== 'object' || !target.import) continue
    const name = path === '.' ? 'phoria2' : `phoria2/${path.slice(2)}`
    alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}$`), replacement: join(built, target.import.replace('./dist/', '')) })
  }
}
const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'error', server: { port: 0 }, resolve: { alias } })
await server.listen()
const url = `${server.resolvedUrls?.local[0]}perf.html?auto${scenes.length ? `&scenes=${scenes.join(',')}` : ''}${pictures ? '&pictures' : ''}`

const profile = mkdtempSync(join(tmpdir(), 'phoria2-perf-'))
const browser = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--ignore-gpu-blocklist', '--enable-gpu', '--window-size=1000,800', url,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
  // Chrome writes the port it chose into the profile
  let port = 0
  for (let i = 0; i < 100 && !port; i++) {
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
    else await sleep(100)
  }
  if (!port) throw new Error('Chrome did not open its debugging port')
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = pages.find((p) => p.type === 'page' && p.url.includes('perf.html'))
  if (!page) throw new Error('the perf page did not open')

  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    socket.onopen = r
    socket.onerror = j
  })
  let id = 0
  /** @type {Map<number, (value: any) => void>} */
  const waiting = new Map()
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    waiting.get(msg.id)?.(msg.result)
    waiting.delete(msg.id)
  }
  const evaluate = (expression) => new Promise((r) => {
    waiting.set(++id, (result) => r(result?.result?.value))
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })

  let perf = null
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    perf = await evaluate('window.__perf && window.__perf.done ? window.__perf : null')
    if (perf) break
    await sleep(500)
  }
  socket.close()
  if (!perf) throw new Error('the perf run did not finish in 10 minutes')

  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim()
    if (execSync('git status --porcelain .', { cwd: root }).toString().trim()) commit += '-dirty'
  } catch { /* not a git checkout */ }
  const out = join(root, 'perf', 'results')
  mkdirSync(out, { recursive: true })
  // a partial run gets a file of its own, so it doesn't replace the full run's of the same commit
  const file = join(out, `${perf.env.date.slice(0, 10)}-${commit}${scenes.length ? `-${scenes.join('+')}` : ''}.json`)
  const { pictures: shots = {}, ...kept } = perf
  writeFileSync(file, JSON.stringify({ commit, phoria2: fromSource ? 'source' : 'built', ...kept }, null, 2))
  if (pictures) {
    const dir = join(out, 'pictures')
    mkdirSync(dir, { recursive: true })
    for (const [name, data] of Object.entries(shots)) writeFileSync(join(dir, `${name}.png`), Buffer.from(String(data).split(',')[1], 'base64'))
    console.log(`${Object.keys(shots).length} pictures in ${dir}`)
  }

  console.log(`GPU: ${perf.env.gpu}`)
  console.log(`phoria2: ${fromSource ? 'from src/ (--source)' : 'built'}`)
  console.log(`${'scene'.padEnd(20)}${'metric'.padEnd(28)}${'phoria2'.padStart(10)}${'three.js'.padStart(10)}`)
  const fmt = (v) => (v === null ? '-' : v >= 100 ? v.toFixed(0) : v.toFixed(2))
  for (const r of perf.results) {
    console.log(`${r.scene.padEnd(20)}${`${r.metric} (${r.unit})`.padEnd(28)}${fmt(r.phoria2).padStart(10)}${fmt(r.three).padStart(10)}`)
  }
  console.log(`\nsaved ${file}`)
} finally {
  browser.kill()
  await server.close()
  // Chrome may hold the profile a moment after it exits
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* left for the OS to clean */ }
}
