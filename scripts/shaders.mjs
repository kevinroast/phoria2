// npm run shaders: compile every shader variant the renderer builds on this machine's GPU, in
// headless Chrome (shaders.html, scripts/shaders-page.js), and report each that fails with its
// driver's log. Exits with 1 if any does, so it can gate a release - run it before one (RELEASING.md).
import { openPage, sleep } from './headless.mjs'

const page = await openPage('shaders.html', { width: 600, height: 400 })
let report = null
const started = Date.now()
try {
  const deadline = started + 600_000
  let shown = ''
  while (Date.now() < deadline && !report) {
    report = await page.evaluate('window.__shaders && window.__shaders.done ? window.__shaders : null')
    if (!report) {
      const progress = await page.evaluate("document.getElementById('log')?.textContent ?? ''")
      if (progress && progress !== shown && progress.length < 40) process.stdout.write(`\r${shown = progress}   `)
      await sleep(500)
    }
  }
} finally {
  await page.close()
}
process.stdout.write('\r')
if (!report) throw new Error('the shader check did not finish in ten minutes')
if (report.error) throw new Error(`the shader check failed to run:\n${report.error}`)

const failed = report.results.filter((r) => !r.ok)
for (const r of failed) console.log(`FAILED  ${r.name}\n${r.error}\n`)
console.log(`${report.results.length} variants drawn in ${Math.round((Date.now() - started) / 1000)} s - ${report.programs} programs compiled - ${failed.length ? `${failed.length} failed` : 'all compiled'}`)
if (failed.length) process.exitCode = 1
