// Build check: the shaders' //@hook lines - where shader hooks are spliced in - must all reach the
// built files. The build strips GLSL comments, and 1.4.0 shipped with these stripped too: every
// material's hooks were left out without a sound, while the tests (run on the source) passed.
// Runs after each build, so a build like that fails before it can be published or deployed.
//
//   node scripts/check-dist.mjs [dir]     (dir: dist by default; the demos build passes its assets)
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dir = resolve(root, process.argv[2] ?? 'dist')
const MARK = /^\s*\/\/@hook (\w+)$/gm

/** Each hook line's part, counted over the .js files under a folder. @param {string} folder */
function count(folder) {
  /** @type {Record<string, number>} */
  const counts = {}
  for (const file of readdirSync(folder, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.js')) continue
    for (const [, part] of readFileSync(join(folder, file), 'utf8').matchAll(MARK)) counts[part] = (counts[part] ?? 0) + 1
  }
  return counts
}

const want = count(join(root, 'src'))
const got = count(dir)
const parts = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort()
// fewer is the fault; more is only a chunk bundled twice
const wrong = parts.filter((p) => (got[p] ?? 0) < (want[p] ?? 0))
if (!parts.length) {
  console.error('check-dist: no //@hook lines in src - has the marker changed? Update this check to match.')
  process.exit(1)
}
if (wrong.length) {
  console.error(`check-dist: ${dir} has lost shader hook lines - shader hooks would do nothing in this build.`)
  for (const p of wrong) console.error(`  //@hook ${p}: ${got[p] ?? 0} built, ${want[p]} in src`)
  console.error('Is the build stripping them as GLSL comments? See minifyGlsl in vite.config.js.')
  process.exit(1)
}
console.log(`check-dist: all ${parts.map((p) => `${want[p]} ${p}`).join(', ')} hook lines are in ${dir}`)
