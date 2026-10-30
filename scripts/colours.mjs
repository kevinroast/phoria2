// npm run colours: run the colour check (colours.html) in headless Chrome and report each swatch
// that doesn't come out at the colour it was given. Exits with 1 if any is off, so it can gate a
// release. What the check draws and why is in scripts/colours-page.js.
import { openPage, sleep } from './headless.mjs'

const page = await openPage('colours.html', { width: 1100, height: 900 })
let report = null
try {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline && !report) {
    report = await page.evaluate('window.__colours && window.__colours.done ? window.__colours : null')
    if (!report) await sleep(250)
  }
} finally {
  await page.close()
}
if (!report) throw new Error('the colour check did not finish in a minute')
if (report.error) throw new Error(`the colour check failed to run:\n${report.error}`)

const hex = (c) => (c ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : '-')
let current = ''
for (const r of report.results) {
  if (r.check !== current) console.log(`\n${current = r.check}`)
  const mark = r.ok === null ? '  ' : r.ok ? 'ok' : 'OFF'
  console.log(`  ${mark.padEnd(4)}${r.swatch.padEnd(12)}expected ${hex(r.expected).padEnd(8)} got ${hex(r.got)}`)
}
const checked = report.results.filter((r) => r.ok !== null), off = checked.filter((r) => !r.ok)
console.log(`\n${checked.length - off.length} of ${checked.length} swatches exact (within 1 in 255)`)
if (off.length) process.exitCode = 1
