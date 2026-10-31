// The tutorial page: each <figure class="step" data-step="..."> becomes the step's code - its new
// lines marked - beside the step running in a frame, with buttons to copy it as one HTML file or
// open it in CodePen. <figure class="whole-page" data-step="..."> shows a step as that file.
import { CODE, hasMarkup, markupFor, importMap, pageFor, previous, version } from './steps.js'

const KEYWORDS = new Set(['import', 'from', 'const', 'let', 'new', 'return', 'if', 'for', 'of', 'true', 'false', 'null', 'export', 'default', 'function'])

/** @param {string} s */
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** JavaScript, lightly coloured: comments, strings, numbers and keywords. @param {string} line */
function colourJs(line) {
  return line.replace(/(\/\/.*$|\/\*\*.*?\*\/)|('(?:\\.|[^'])*'|`(?:\\.|[^`])*`)|(\b\d+(?:\.\d+)?\b)|(\b[a-zA-Z_]\w*\b)|([^'`/\w]+|\/)/g,
    (m, comment, string, number, word) => {
      if (comment) return `<span class="t-comment">${escape(m)}</span>`
      if (string) return `<span class="t-string">${escape(m)}</span>`
      if (number) return `<span class="t-number">${m}</span>`
      if (word && KEYWORDS.has(m)) return `<span class="t-keyword">${m}</span>`
      return escape(m)
    })
}

/** HTML, lightly coloured: tag names and attribute values, in one pass. @param {string} line */
function colourHtml(line) {
  return line.replace(/(<\/?)([\w-]+)|("[^"]*")|([^<"]+|<)/g, (m, open, tag, string) => {
    if (tag) return `${escape(open)}<span class="t-keyword">${tag}</span>`
    if (string) return `<span class="t-string">${escape(string)}</span>`
    return escape(m)
  })
}

/**
 * A code block: lines coloured, and those the step before didn't have marked as new.
 * @param {string} text @param {'js' | 'html'} kind @param {string | null} [before]
 */
function codeBlock(text, kind, before = null) {
  const had = new Map()
  for (const l of (before ?? '').split('\n')) had.set(l.trim(), (had.get(l.trim()) ?? 0) + 1)
  const lines = text.trimEnd().split('\n').map((line) => {
    const key = line.trim()
    const isNew = before !== null && key !== '' && !((had.get(key) ?? 0) > 0)
    if (!isNew) had.set(key, (had.get(key) ?? 0) - 1)
    const html = kind === 'js' ? colourJs(line) : colourHtml(line)
    return `<span class="line${isNew ? ' new' : ''}">${html || ' '}</span>`
  })
  // each line is a block of its own, so no newlines between them
  return `<pre class="code"><code>${lines.join('')}</code></pre>`
}

/** @param {HTMLButtonElement} button @param {string} text */
async function copy(button, text) {
  const label = button.textContent
  try {
    await navigator.clipboard.writeText(text)
    button.textContent = 'Copied'
  } catch {
    button.textContent = 'Select and copy instead'
  }
  setTimeout(() => { button.textContent = label }, 1500)
}

/** Open a step in CodePen, as a new pen: the import map in the head, the markup and code in the body. @param {string} name */
function openInCodePen(name) {
  const form = document.createElement('form')
  form.action = 'https://codepen.io/pen/define'
  form.method = 'POST'
  form.target = '_blank'
  const input = document.createElement('input')
  input.type = 'hidden'
  input.name = 'data'
  input.value = JSON.stringify({
    title: `phoria2 tutorial - ${name}`,
    head: importMap(CODE[name]),
    html: `${markupFor(name)}\n<script type="module">\n${CODE[name]}</script>\n`,
  })
  form.append(input)
  document.body.append(form)
  form.submit()
  form.remove()
}

for (const figure of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('figure.step'))) {
  const name = /** @type {string} */ (figure.dataset.step)
  if (!CODE[name]) throw new Error(`tutorial: no step '${name}'`)
  const prior = previous(name)
  figure.innerHTML = `
    <div class="step-code">
      ${hasMarkup(name) ? `<div class="code-title">HTML</div>${codeBlock(markupFor(name), 'html')}` : ''}
      <div class="code-title">JavaScript${prior ? '<span class="new-key">new in this step</span>' : ''}</div>
      ${codeBlock(CODE[name], 'js', prior)}
    </div>
    <div class="step-result">
      <iframe src="tutorial-run.html?step=${name}" title="The running result of this step" loading="lazy"></iframe>
      <div class="step-actions">
        <button type="button" data-act="rerun" title="Start this step again">Run again</button>
        <button type="button" data-act="copy" title="The whole step as one HTML file - save it and open it in a browser">Copy as one page</button>
        <button type="button" data-act="codepen" title="Open this step in CodePen to change it">Open in CodePen</button>
      </div>
    </div>`
  const frame = /** @type {HTMLIFrameElement} */ (figure.querySelector('iframe'))
  figure.addEventListener('click', (e) => {
    const button = /** @type {HTMLElement} */ (e.target).closest('button')
    if (!button) return
    if (button.dataset.act === 'rerun') frame.contentWindow?.location.reload()
    else if (button.dataset.act === 'copy') copy(/** @type {HTMLButtonElement} */ (button), pageFor(name))
    else if (button.dataset.act === 'codepen') openInCodePen(name)
  })
}

// a step as the one HTML file it makes
for (const figure of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('figure.whole-page'))) {
  const name = /** @type {string} */ (figure.dataset.step)
  figure.innerHTML = `<div class="code-title">index.html</div>${codeBlock(pageFor(name), 'html')}`
}

for (const el of document.querySelectorAll('.version')) el.textContent = version
