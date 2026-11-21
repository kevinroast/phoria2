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

// And the GLSL parts loaded on their own (src/webgl/parts.js): each `#pragma part NAME` line in the
// shaders must have its part's code somewhere in the build. A part module only imported for its
// effect is dropped by a bundler (package.json's sideEffects says modules have none) - so a shadow
// would ask for GLSL that never shipped, and stop the frame.
const sources = readFileSync(join(root, 'src/webgl/shaders.js'), 'utf8')
const names = [...sources.matchAll(/^#pragma part ([\w-]+)$/gm)].map((m) => m[1])
const built = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
// a part is an entry of a table: its name, quoted or not, then its GLSL - a string, any quotes
const missing = names.filter((name) => !new RegExp(`["']?${name}["']?\\s*:\\s*(?:/\\*\\s*glsl\\s*\\*/\\s*)?["'\`]`).test(built))
if (!names.length) {
  console.error('check-dist: no #pragma part lines in src/webgl/shaders.js - has the marker changed? Update this check to match.')
  process.exit(1)
}
if (missing.length) {
  console.error(`check-dist: ${dir} has lost GLSL parts - a frame that needs one would fail to compile: ${missing.join(', ')}`)
  console.error('Is a parts module imported only for its effect? Register its table from code that is used (see parts.js).')
  process.exit(1)
}
console.log(`check-dist: all ${names.length} GLSL parts are in ${dir}`)
