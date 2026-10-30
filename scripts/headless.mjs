// A page of this repo in headless Chrome, for scripts that check what the library draws: serves the
// repo with Vite, opens the page in the Chrome installed (nothing is downloaded - set CHROME to its
// path if it isn't found), and talks to it over the DevTools protocol.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const root = resolve(import.meta.dirname, '..')
const CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

export const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Open a page of the repo - a path such as 'colours.html?auto' - in headless Chrome.
 * @param {string} path
 * @param {{ width?: number, height?: number }} [size]
 * @returns {Promise<{ evaluate: (expression: string) => Promise<any>, close: () => Promise<void> }>}
 */
export async function openPage(path, { width = 1000, height = 800 } = {}) {
  const chrome = CANDIDATES.find((p) => p && existsSync(p))
  if (!chrome) throw new Error('No Chrome found - set CHROME to its path')
  const server = await createServer({ root, configFile: join(root, 'vite.config.js'), logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = `${server.resolvedUrls?.local[0]}${path}`
  const profile = mkdtempSync(join(tmpdir(), 'phoria2-headless-'))
  const browser = spawn(chrome, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--ignore-gpu-blocklist', '--enable-gpu', `--window-size=${width},${height}`, url,
  ], { stdio: 'ignore' })
  const close = async () => {
    browser.kill()
    await server.close()
    // Chrome may hold the profile a moment after it exits
    await sleep(500)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* left for the OS to clean */ }
  }
  try {
    // Chrome writes the port it chose into the profile
    let port = 0
    for (let i = 0; i < 100 && !port; i++) {
      const file = join(profile, 'DevToolsActivePort')
      if (existsSync(file)) port = Number(readFileSync(file, 'utf8').split('\n')[0])
      else await sleep(100)
    }
    if (!port) throw new Error('Chrome did not open its debugging port')
    const name = path.split('?')[0]
    let page = null
    for (let i = 0; i < 50 && !page; i++) {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      page = pages.find((/** @type {any} */ p) => p.type === 'page' && p.url.includes(name))
      if (!page) await sleep(100)
    }
    if (!page) throw new Error(`${name} did not open`)
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
    const evaluate = (/** @type {string} */ expression) => new Promise((r) => {
      waiting.set(++id, (result) => r(result?.result?.value))
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
    })
    return {
      evaluate,
      close: async () => {
        socket.close()
        await close()
      },
    }
  } catch (e) {
    await close()
    throw e
  }
}
