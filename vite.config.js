import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname

// The package entry points: 'phoria2' (the core), 'phoria2/particles', 'phoria2/charts', 'phoria2/gltf',
// 'phoria2/motion' and 'phoria2/edit'.
// The library build emits one ES module per entry (dist/phoria2.js, dist/particles.js, ...).
const ENTRIES = {
  phoria2: 'src/index.js',
  particles: 'src/particles/index.js',
  charts: 'src/charts/index.js',
  gltf: 'src/gltf/index.js',
  motion: 'src/motion/index.js',
  edit: 'src/edit/index.js',
}

/**
 * Shaders ship as source text, which the JS minifier leaves alone: strip their comments and
 * indentation in builds (strings tagged \/* glsl *\/). Lines stay lines, for the preprocessor.
 * @returns {import('vite').Plugin}
 */
export function minifyGlsl() {
  return {
    name: 'phoria2-minify-glsl',
    apply: 'build',
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.js$/.test(id) || !code.includes('/* glsl */')) return null
      return code.replace(/\/\* glsl \*\/ `([\s\S]*?)`/g, (_, body) =>
        `/* glsl */ \`${body.split('\n').map((line) => line.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n')}\n\``)
    },
  }
}

// The agent reference (llms.txt, and llms-full.txt with the whole API) lives at the package root, so
// it ships in the npm package; the demo site serves it too, from its own root.
const AGENT_DOCS = ['llms.txt', 'llms-full.txt']

/** @param {boolean} emit write them into the build @returns {import('vite').Plugin} */
function agentDocs(emit) {
  return {
    name: 'phoria2-agent-docs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.slice(1)
        if (!name || !AGENT_DOCS.includes(name)) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(readFileSync(resolve(root, name)))
      })
    },
    generateBundle() {
      if (emit) for (const name of AGENT_DOCS) this.emitFile({ type: 'asset', fileName: name, source: readFileSync(resolve(root, name), 'utf8') })
    },
  }
}

/**
 * The tutorial's steps run for what they do and export nothing - and the package says its modules
 * have no side effects, so a build would empty them. Keep them whole.
 * @returns {import('vite').Plugin}
 */
function tutorialSteps() {
  return {
    name: 'phoria2-tutorial-steps',
    transform(code, id) {
      if (/[\\/]demos[\\/]tutorial[\\/]steps[\\/][^?]*\.js$/.test(id)) return { code, map: null, moduleSideEffects: true }
      return null
    },
  }
}

// Default build is the library. `--mode demos` builds the demo gallery as a static site instead.
// In dev, demos import 'phoria2' and its sub-paths straight from src/.
export default defineConfig(({ mode }) => ({
  // relative base so the demo site works from any folder on a static host
  base: mode === 'demos' ? './' : '/',
  plugins: [minifyGlsl(), agentDocs(mode === 'demos'), tutorialSteps()],
  resolve: {
    alias: [
      { find: /^phoria2$/, replacement: resolve(root, ENTRIES.phoria2) },
      { find: /^phoria2\/particles$/, replacement: resolve(root, ENTRIES.particles) },
      { find: /^phoria2\/charts$/, replacement: resolve(root, ENTRIES.charts) },
      { find: /^phoria2\/gltf$/, replacement: resolve(root, ENTRIES.gltf) },
      { find: /^phoria2\/motion$/, replacement: resolve(root, ENTRIES.motion) },
      { find: /^phoria2\/edit$/, replacement: resolve(root, ENTRIES.edit) },
    ],
  },
  build: mode === 'demos'
    ? {
        outDir: 'dist-demos',
        rollupOptions: {
          input: {
            index: resolve(root, 'index.html'),
            demo: resolve(root, 'demo.html'),
            tutorial: resolve(root, 'tutorial.html'),
            'tutorial-run': resolve(root, 'tutorial-run.html'),
          },
        },
      }
    : {
        lib: {
          entry: Object.fromEntries(Object.entries(ENTRIES).map(([name, file]) => [name, resolve(root, file)])),
          formats: ['es'],
          fileName: (format, name) => `${name}.js`,
        },
        sourcemap: true,
        copyPublicDir: false,
        rollupOptions: {
          output: {
            // everything the sub-paths share with the core goes in one predictable chunk; modules
            // loaded on demand (explain, toImage, the tooltip, the .hdr parser, the renderer's
            // environment and shadow passes, bloom, GPU picking) keep chunks of their own
            manualChunks: (id) => (/[\\/]src[\\/](?!particles|charts|gltf|motion|edit|explain|snapshot|tooltip|hdr|irradiance|webgl[\\/](?:passes|picking|bloom))/.test(id) ? 'core' : undefined),
            chunkFileNames: '[name].js',
          },
        },
      },
  test: {
    include: ['test/**/*.test.js'],
  },
}))
