#!/usr/bin/env node
// Look at a phoria2 page the way a person would, and report what a coding agent can't see: load it
// in the installed Chrome (headless), then print console errors and warnings, failed requests, the
// canvases and their sizes, view.explain() for window.view, how many WebGL draws happen while the
// page sits idle, and the text of any tooltip at points you hover - and save a screenshot to look at.
//
//   node check.mjs http://localhost:5173/              a page your dev server is serving
//   node check.mjs index.html                          a file - served from its own folder
//   node check.mjs page.html --hover 600,400 --hover 300,500 --size 1280x800 --wait 3 --out shot.png
//
// Needs Node 22 or later and Chrome, Chromium or Edge (set CHROME to its path if it isn't found).
// Exits 1 if the page threw, logged an error, failed a request, or has no canvas.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const target = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!target) {
  console.error('usage: node check.mjs <url | file.html> [--hover x,y]... [--size WxH] [--wait seconds] [--out file.png]')
  process.exit(2)
}
const [WIDTH, HEIGHT] = flag('--size', '1200x800').split('x').map(Number)
const WAIT = Number(flag('--wait', '2'))
const hovers = args.flatMap((a, i) => (a === '--hover' ? [args[i + 1].split(',').map(Number)] : []))
const out = resolve(flag('--out', join(tmpdir(), 'phoria2-check.png')))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && existsSync(p))
if (!chrome) {
  console.error('No Chrome, Chromium or Edge found - set CHROME to its path')
  process.exit(2)
}

// a file is served over http from its own folder, so its modules, models and textures load
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
}
let server = null, url = target, fileNote = null
if (!/^https?:\/\//.test(target)) {
  const file = resolve(target)
  if (!existsSync(file)) {
    console.error(`No such file: ${file}`)
    process.exit(2)
  }
  const root = dirname(file)
  server = createServer((req, res) => {
    const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
    // a page without an icon isn't broken: browsers ask for one anyway
    if (path === join(root, 'favicon.ico') && !existsSync(path)) {
      res.writeHead(204).end()
      return
    }
    if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' })
    res.end(readFileSync(path))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  url = `http://127.0.0.1:${server.address().port}/${basename(file)}`
  // this check serves the file, which hides a page that only works when served
  if (/<script[^>]*type=["']module["'][^>]*\ssrc=["'](?!https?:)/i.test(readFileSync(file, 'utf8'))) {
    fileNote = 'This page loads a module script from a file - opened straight from a folder (file://) it stays blank. Keep the code inline in the page if it must open that way.'
  }
}

const profile = mkdtempSync(join(tmpdir(), 'phoria2-check-'))
const browser = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  // WebGL on the GPU where there is one, in software where there isn't
  '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
], { stdio: 'ignore' })

// counts every WebGL draw, to tell a page that sits idle from one that redraws all the time
const COUNT_DRAWS = `(() => {
  window.__draws = 0
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue
    for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const fn = C.prototype[name]
      if (fn) C.prototype[name] = function (...a) { window.__draws++; return fn.apply(this, a) }
    }
  }
})()`

const problems = [], notes = [], failed = []
let code = 0
try {
  let port = 0
  for (let i = 0; i < 150 && !port; i++) {
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
    else await sleep(100)
  }
  if (!port) throw new Error('Chrome did not open its debugging port')
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j })
  let id = 0
  const waiting = new Map(), events = new Map()
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id) {
      waiting.get(msg.id)?.(msg)
      waiting.delete(msg.id)
    } else events.get(msg.method)?.(msg.params)
  }
  const send = (method, params = {}) => new Promise((r) => {
    waiting.set(++id, r)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const msg = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return msg.result?.result?.value
  }
  const text = (a) => a.map((x) => x.value ?? x.description ?? '').join(' ')

  events.set('Runtime.consoleAPICalled', ({ type, args: a }) => {
    if (type === 'error') problems.push(`console.error: ${text(a)}`)
    else if (type === 'warning') notes.push(`console.warn: ${text(a)}`)
    else if (type === 'log' || type === 'info') notes.push(`console.${type}: ${text(a)}`)
  })
  events.set('Runtime.exceptionThrown', ({ exceptionDetails: d }) =>
    problems.push(`uncaught: ${d.exception?.description ?? d.text}`))
  // a missing favicon is the browser asking, not the page failing
  const icon = (u) => /\/favicon\.ico(\?|$)/.test(u ?? '')
  events.set('Log.entryAdded', ({ entry }) => { if (entry.level === 'error' && !icon(entry.url)) problems.push(`${entry.source}: ${entry.text}${entry.url ? ` (${entry.url})` : ''}`) })
  events.set('Network.responseReceived', ({ response }) => { if (response.status >= 400 && !icon(response.url)) failed.push(`${response.status} ${response.url}`) })
  events.set('Network.loadingFailed', ({ errorText, canceled }) => { if (!canceled) failed.push(`failed: ${errorText}`) })
  let loaded = null
  const load = new Promise((r) => { loaded = r })
  events.set('Page.loadEventFired', () => loaded())

  await Promise.all([send('Page.enable'), send('Runtime.enable'), send('Log.enable'), send('Network.enable')])
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_DRAWS })
  await send('Page.navigate', { url })
  await Promise.race([load, sleep(15000)])
  await sleep(WAIT * 1000)

  const canvases = await evaluate(`[...document.querySelectorAll('canvas')].map((c) => ({
    css: Math.round(c.clientWidth) + 'x' + Math.round(c.clientHeight), buffer: c.width + 'x' + c.height,
    webgl: !!(c.getContext && (() => { try { return c.getContext('webgl2') } catch { return null } })()),
  }))`) ?? []
  const explained = await evaluate(`(async () => {
    const views = [window.view, ...(Array.isArray(window.views) ? window.views : [])].filter((v) => v && typeof v.explain === 'function')
    return Promise.all(views.map(async (v) => { try { return await v.explain() } catch (e) { return 'explain() threw: ' + e.message } }))
  })()`) ?? []
  // idle: nothing moving and nothing touched, a phoria2 view draws nothing
  await evaluate('window.__draws = 0')
  await sleep(2000)
  const idleDraws = await evaluate('window.__draws')

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  const hovered = []
  for (const [i, [x, y]] of hovers.entries()) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(500)
    // the tooltip is position: fixed, so it has no offsetParent - shown means it has a size and isn't hidden
    const tip = await evaluate(`[...document.querySelectorAll('.phoria-tooltip')].filter((t) => {
      const s = getComputedStyle(t), r = t.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
    }).map((t) => {
      // { title, rows } tooltips: the title, then each row as name: value
      const title = t.querySelector('.phoria-tooltip-title'), cells = [...t.querySelectorAll('.phoria-tooltip-rows > span')]
      if (!title && !cells.length) return t.innerText.split('\\n').map((l) => l.trim()).filter(Boolean).join(' / ')
      const rows = []
      for (let i = 0; i + 1 < cells.length; i += 2) rows.push(cells[i].textContent + ': ' + cells[i + 1].textContent)
      return [title?.textContent, ...rows].filter(Boolean).join(' / ')
    }).join(' | ')`)
    const file = out.replace(/\.png$/i, '') + `-hover${i + 1}.png`
    writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
    hovered.push(`(${x}, ${y}): ${tip || 'no tooltip'} - ${file}`)
  }
  socket.close()

  const section = (title, lines) => lines.length && console.log(`\n${title}\n${lines.map((l) => `  ${l}`).join('\n')}`)
  console.log(`phoria2 check: ${url} at ${WIDTH}x${HEIGHT}`)
  if (fileNote) console.log(`\nNote: ${fileNote}`)
  section('Errors', problems)
  section('Failed requests', failed)
  section('Console', notes.slice(0, 30))
  section('Canvases', canvases.length ? canvases.map((c) => `${c.css} on the page, ${c.buffer} drawing buffer${c.css.startsWith('0x') || c.css.endsWith('x0') ? ' - NO SIZE: give the canvas a width and height in CSS' : ''}`) : ['none - nothing is drawn'])
  console.log(`\nIdle draws in 2 seconds: ${idleDraws ?? 'unknown'}${idleDraws > 0 ? ' - something keeps redrawing (an animation, view.start() with work every frame, or renderMode: \'always\')' : ''}`)
  if (explained.length) explained.forEach((r, i) => console.log(`\nview.explain()${explained.length > 1 ? ` #${i + 1}` : ''}:\n${r.replace(/^/gm, '  ')}`))
  else console.log('\nview.explain(): no window.view - add `window.view = view` while developing to see it here')
  section('Hover', hovered)
  console.log(`\nScreenshot: ${out}`)
  if (problems.length || failed.length || !canvases.length) code = 1
} catch (e) {
  console.error(`check failed: ${e.message}`)
  code = 2
} finally {
  browser.kill()
  server?.close()
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* Chrome may still hold it */ }
}
process.exit(code)
