// The tutorial's steps: each a program exactly as a reader writes it (steps/<part>-<n>.js), with the
// page markup it runs in (steps/<part>-<n>.html, or the last earlier step's in the same part, or a
// full-page canvas). The tutorial shows these files' own text and runs the same files, so the code
// on the page is always the code that drew the picture beside it.
import { version } from '../../package.json'

/** The steps' source, by name. @type {Record<string, string>} */
export const CODE = Object.fromEntries(Object.entries(
  /** @type {Record<string, string>} */ (import.meta.glob('./steps/*.js', { query: '?raw', import: 'default', eager: true })),
).map(([path, text]) => [nameOf(path), text]))

/** The steps' own markup, by name. @type {Record<string, string>} */
const HTML = Object.fromEntries(Object.entries(
  /** @type {Record<string, string>} */ (import.meta.glob('./steps/*.html', { query: '?raw', import: 'default', eager: true })),
).map(([path, text]) => [nameOf(path), text]))

/** The steps as modules, to run. */
export const MODULES = Object.fromEntries(Object.entries(import.meta.glob('./steps/*.js')).map(([path, load]) => [nameOf(path), load]))

// a canvas filling the page - what a step runs in when it brings no markup of its own
const CANVAS = `<style>
  body { margin: 0 }
  #scene { display: block; width: 100%; height: 100vh }
</style>
<canvas id="scene"></canvas>
`

/** @param {string} path @returns {string} */
function nameOf(path) {
  return /** @type {string} */ (path.split('/').pop()).replace(/\.(js|html)$/, '')
}

/**
 * The markup a step runs in: its own, the last earlier step's in its part, or a full-page canvas.
 * @param {string} name e.g. 'dashboard-4'
 */
export function markupFor(name) {
  const [, part, n] = /** @type {RegExpMatchArray} */ (name.match(/^(.*)-(\d+)$/))
  for (let i = Number(n); i >= 1; i--) if (HTML[`${part}-${i}`]) return HTML[`${part}-${i}`]
  return CANVAS
}

/** Whether a step brings markup of its own, to show beside its code. @param {string} name */
export const hasMarkup = (name) => name in HTML

/** The step before, in the same part - what this one adds to. @param {string} name */
export function previous(name) {
  const [, part, n] = /** @type {RegExpMatchArray} */ (name.match(/^(.*)-(\d+)$/))
  return CODE[`${part}-${Number(n) - 1}`] ?? null
}

/** The import map for a step: phoria2 from the CDN, and the sub-paths its code imports. @param {string} code */
export function importMap(code) {
  const paths = ['phoria2', ...new Set([...code.matchAll(/from 'phoria2\/(\w+)'/g)].map((m) => `phoria2/${m[1]}`))]
  const file = (p) => (p === 'phoria2' ? 'phoria2' : p.slice('phoria2/'.length))
  const lines = paths.map((p) => `    "${p}": "https://cdn.jsdelivr.net/npm/phoria2@${version}/dist/${file(p)}.js"`)
  return `<script type="importmap">\n{ "imports": {\n${lines.join(',\n')}\n} }\n</script>`
}

/** A step as one complete HTML file: save it, open it in a browser, and it runs. @param {string} name */
export function pageFor(name) {
  const code = CODE[name]
  const indent = (text, by) => text.trimEnd().split('\n').map((l) => (l ? by + l : l)).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>phoria2</title>
${indent(importMap(code), '  ')}
</head>
<body>
${indent(markupFor(name), '  ')}
  <script type="module">
${indent(code, '    ')}
  </script>
</body>
</html>
`
}

export { version }
