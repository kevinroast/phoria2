// npm run thumbs: open each demo in headless Chrome (the one installed - nothing is downloaded), let
// it run a few seconds, and save a small picture of it to public/thumbs/<name>.webp for the
// gallery's cards. The picture is the demo's view.toImage() - the canvas with its labels painted in -
// except for demos made of several views, which are captured from the page with its panels hidden.
// Run it after changing how a demo looks; `npm run thumbs -- space galaxy` redoes only those. Set
// CHROME to the browser's path if it isn't found.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEMOS } from '../demos/registry.js'

const WIDTH = 960, HEIGHT = 600, SCALE = 0.5
// seconds to let a demo run first - longer for those that load models or build up to something
const WAIT = { viewer: 7, fireworks: 6, paint: 7, particles: 5, space: 4.5, textures: 5, lights: 5, artemis: 4, cpu: 4, volcano: 5, engine: 4.5 }
// several views on one page: captured from the page, not one view's toImage() - for cells, the
// whole poster: both cells, their titles and the paper behind them
const PAGE = ['dashboard', 'cells']
// set a demo up for its picture first - scene-json aims off-centre to clear its editor panel, which
// the picture leaves out: its turntable goes back to the start, with the objects side by side, and it
// is framed in the middle from a little to the right and above; artemis stops on its way home, with
// the whole route drawn; cpu is running, its traces alight; volcano is erupting, its lava running;
// cells is scrolled past the poster's heading, to the two cells, its scrollbar hidden; carbide is
// seen from a little closer than its framing, which leaves room for the blade's whole sweep
const PREPARE = {
  carbide: `const { position: p, target: t } = view.camera
    p.set(t[0] + (p[0] - t[0]) * 0.7, t[1] + (p[1] - t[1]) * 0.7, t[2] + (p[2] - t[2]) * 0.7)
    view.invalidate()`,
  cells: `document.querySelector('.cells-poster').style.scrollbarWidth = 'none'
    document.querySelector('.cells-pair').scrollIntoView({ block: 'center' })`,
  // played for a moment, so the fountain's sparks have built up
  volcano: `(async () => {
    story.seekStep(4)
    story.seek(story.time + 0.8)
    story.play()
    await new Promise((r) => setTimeout(r, 1200))
    story.pause()
  })()`,
  cpu: `story.pause()
    story.seekStep(6)
    story.seek(story.time + 3.2)`,
  artemis: `story.pause()
    story.seekStep(15)
    story.seek(story.time + 3.6)`,
  'scene-json': `view.scene.find('turntable').rotation.set(0, 0, 0)
    view.camera.position.set(2.5, 4, 9)
    view.camera.target.set(0, 0.9, 0)
    view.frame(view.scene, { padding: 0.1 })`,
}

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
const asked = process.argv.slice(2)
const names = DEMOS.map((d) => d.name).filter((n) => !asked.length || asked.includes(n))
const out = join(root, 'public', 'thumbs')
mkdirSync(out, { recursive: true })

const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'error', server: { port: 0 } })
await server.listen()
const base = server.resolvedUrls?.local[0]
const profile = mkdtempSync(join(tmpdir(), 'phoria2-thumbs-'))
const browser = spawn(chrome, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank',
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
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    socket.onopen = r
    socket.onerror = j
  })
  let id = 0
  /** @type {Map<number, (msg: any) => void>} */
  const waiting = new Map()
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    waiting.get(msg.id)?.(msg)
    waiting.delete(msg.id)
  }
  const send = (method, params = {}) => new Promise((r) => {
    waiting.set(++id, r)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'page error')
    return result?.result?.value
  }
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false })

  for (const name of names) {
    await send('Page.navigate', { url: `${base}demo.html?name=${name}` })
    await sleep((WAIT[name] ?? 3.5) * 1000)
    if (PREPARE[name]) {
      await evaluate(PREPARE[name])
      await sleep(300)
    }
    let data
    if (!PAGE.includes(name) && await evaluate('!!window.view?.toImage')) {
      // the view's own picture, scaled down and re-encoded in the page
      data = await evaluate(`(async () => {
        const bitmap = await createImageBitmap(await window.view.toImage())
        const small = new OffscreenCanvas(${WIDTH * SCALE}, ${HEIGHT * SCALE})
        small.getContext('2d').drawImage(bitmap, 0, 0, small.width, small.height)
        const bytes = new Uint8Array(await (await small.convertToBlob({ type: 'image/webp', quality: 0.8 })).arrayBuffer())
        let s = ''
        for (const b of bytes) s += String.fromCharCode(b)
        return btoa(s)
      })()`)
    } else {
      await evaluate(`document.querySelectorAll('.hud, .panel, .demo-legend').forEach((el) => { el.style.display = 'none' })`)
      await sleep(200)
      const { result } = await send('Page.captureScreenshot', { format: 'webp', quality: 80, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: SCALE } })
      data = result.data
    }
    const bytes = Buffer.from(data, 'base64')
    writeFileSync(join(out, `${name}.webp`), bytes)
    console.log(`${name.padEnd(12)} ${(bytes.length / 1024).toFixed(1)} KB`)
  }
  socket.close()
} finally {
  browser.kill()
  await server.close()
  // Chrome may hold the profile a moment after it exits
  await sleep(500)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* left for the OS to clean */ }
}
