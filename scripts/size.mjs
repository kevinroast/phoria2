// Size check: bundle small sample apps against src/ (as an app's bundler would see the package),
// gzip what loads up front and what loads later, and compare with the budgets in
// size-budgets.json. Fails (exit 1) when anything is over its limit - the limit is the line
// that holds; the target is where the budget wants it.
//
//   npm run size
import { build } from 'vite'
import { gzipSync } from 'node:zlib'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { minifyGlsl } from '../vite.config.js'

const root = resolve(import.meta.dirname, '..')
const budgets = JSON.parse(readFileSync(join(import.meta.dirname, 'size-budgets.json'), 'utf8'))

// the sample apps, one per use case the budgets name
const APPS = {
  'view app': `import { View, Mesh, box, DirectionalLight } from 'phoria2'
const view = new View({ canvas: document.querySelector('canvas'), orbit: true })
view.scene.add(new DirectionalLight({ direction: [-1, -1, -1] }))
view.scene.add(new Mesh({ geometry: box(1), material: { color: 'orange' } }))
view.on('click', (hit) => console.log(hit?.node))`,
  'chart app': `import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
const view = new View({ canvas: document.querySelector('canvas'), orbit: true })
view.scene.add(chart({ mark: 'bar', data: [{ month: 'Jan', sales: 3 }], x: 'month', y: 'sales', color: 'month', tooltip: true }))`,
  'product viewer': `import { View, Mesh, cylinder, DirectionalLight } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'
const view = new View({ canvas: document.querySelector('canvas'), orbit: { autoRotate: true } })
view.scene.environment = 'studio.hdr'
view.scene.background = view.scene.environment
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }))
view.scene.add(new Mesh({ geometry: cylinder({ radius: 2, height: 0.1 }), receiveShadow: true }))
const model = await loadGLTF('chair.glb')
for (const m of model.meshes) m.castShadow = true
view.scene.add(model)
view.frame(model)`,
}

const IMPORT = /(?:^|[;}\s])import\s*(?:[^'"()]*?from\s*)?['"]\.\/([^'"]+)['"]/g
const work = mkdtempSync(join(tmpdir(), 'phoria2-size-'))
const kb = (n) => n / 1024
const rows = []
try {
  for (const [name, code] of Object.entries(APPS)) {
    const dir = join(work, name.replace(/\W+/g, '-'))
    mkdirSync(dir)
    writeFileSync(join(dir, 'main.js'), code)
    await build({
      logLevel: 'silent',
      configFile: false,
      root: dir,
      plugins: [minifyGlsl()],
      resolve: {
        alias: [
          { find: /^phoria2$/, replacement: join(root, 'src/index.js') },
          { find: /^phoria2\/(charts|gltf|particles)$/, replacement: join(root, 'src/$1/index.js') },
        ],
      },
      build: {
        outDir: join(dir, 'out'),
        target: 'es2022',
        lib: { entry: join(dir, 'main.js'), formats: ['es'], fileName: 'app' },
        rollupOptions: { output: { chunkFileNames: '[name].js' } },
      },
    })
    const out = join(dir, 'out')
    const gz = (file) => gzipSync(readFileSync(join(out, file)), { level: 9 }).length
    const files = readdirSync(out).filter((f) => /\.m?js$/.test(f))
    // what the entry imports statically loads with it; dynamic imports load when first used
    const upFront = new Set([files.find((f) => f.startsWith('app'))])
    for (let grew = true; grew;) {
      grew = false
      for (const f of [...upFront]) {
        for (const m of readFileSync(join(out, f), 'utf8').matchAll(IMPORT)) {
          if (upFront.has(m[1])) continue
          upFront.add(m[1])
          grew = true
        }
      }
    }
    const size = kb([...upFront].reduce((n, f) => n + gz(f), 0))
    const later = kb(files.filter((f) => !upFront.has(f)).reduce((n, f) => n + gz(f), 0))
    rows.push({ name, size, later, ...budgets[name] })
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

let failed = false
console.log('gzip KB        up front   (later)   limit   target')
for (const r of rows) {
  const over = r.size > r.limit
  failed ||= over
  const note = over ? '  OVER LIMIT' : r.size > r.target ? '  over target' : ''
  console.log(`${r.name.padEnd(15)}${r.size.toFixed(1).padStart(8)}${`(${r.later.toFixed(1)})`.padStart(10)}${String(r.limit).padStart(8)}${String(r.target).padStart(9)}${note}`)
}
if (failed) {
  console.error('\nOver the size limit. Make it smaller, or - if the growth is worth it - raise the limit in scripts/size-budgets.json in the same change, with the reason.')
  process.exit(1)
}
