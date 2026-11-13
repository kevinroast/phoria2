// Pages of plot cards - the maths and science demos: each card a live plot, a note, its sliders and
// the code that draws it - read from the page's own file, between its markers, so what you read is
// what runs. The formulas are typeset by KaTeX, loaded from the CDN for these pages only.

/** @typedef {{ name: string, title: string, note: string }} Card */
/** @typedef {(o: { canvas: HTMLCanvasElement, slider: ReturnType<typeof sliders>, row: HTMLElement }) => any} Example */

/**
 * A page of cards under the title panel, one plot each, in order - returning the first plot's view.
 * @param {{ canvas: HTMLCanvasElement, cards: Card[], examples: Record<string, Example>, source: string }} options
 */
export async function cardPage({ canvas, cards, examples, source }) {
  canvas.style.display = 'none'
  // the formulas on the cards are typeset by KaTeX
  await loadKatex()
  const page = document.createElement('div')
  page.className = 'demo-cards demo-maths'
  const made = cards.map((card) => {
    const section = document.createElement('section')
    section.className = 'demo-cards-card'
    const h = document.createElement('h3')
    h.textContent = card.title
    const p = document.createElement('p')
    p.textContent = card.note
    const live = document.createElement('canvas')
    live.className = 'demo-maths-canvas'
    const row = document.createElement('div')
    row.className = 'demo-cards-row'
    section.append(h, p, live, row, codeBlock(sourceOf(source, card.name)))
    page.append(section)
    return { card, canvas: live, row }
  })
  document.body.append(page)
  // below the title panel, with the page's usual 16px between
  const title = /** @type {HTMLElement} */ (document.querySelector('.hud-title'))
  const place = () => { page.style.top = `${title.getBoundingClientRect().bottom + 16}px` }
  new ResizeObserver(place).observe(title)
  place()
  const views = made.map(({ card, canvas: c, row }) => examples[card.name]({ canvas: c, slider: sliders(row), row }))
  // every plot's view, for poking at from the console in dev (window.view is the first)
  if (import.meta.env.DEV) Object.assign(window, { views })
  return views[0]
}

// KaTeX, pinned, from the CDN - for these pages only; phoria2 knows nothing of it
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist'
/** @type {any} */
let katex = null

/** Load KaTeX and its stylesheet; without the network the formulas fall back to their text. */
async function loadKatex() {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${KATEX}/katex.min.css` })
  document.head.append(link)
  try {
    katex = (await import(/* @vite-ignore */ `${KATEX}/katex.mjs`)).default
  } catch {
    katex = null
  }
}

/**
 * TeX typeset by KaTeX into an element - a new one, or the one given to change it - or null when
 * KaTeX couldn't load, so a Label shows its text instead.
 * @param {string} source @param {Element} [into]
 */
export function tex(source, into = document.createElement('span')) {
  if (!katex) return null
  katex.render(source, into, { throwOnError: false })
  return into
}

// longer than this, a card's code shows its first lines, fading, until opened
const PREVIEW_LINES = 5

/**
 * A card's code: a few lines fading out, with a button to show it all (and hide it again) and one to
 * copy it - the code is always there to read, without every card being as long as its example.
 * @param {string} code
 */
function codeBlock(code) {
  const block = document.createElement('div')
  block.className = 'demo-code'
  const pre = document.createElement('pre')
  pre.textContent = code
  const bar = document.createElement('div')
  bar.className = 'demo-code-bar'
  const lines = code.split('\n').length
  const copy = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy' })
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code)
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Copy failed'
    }
    setTimeout(() => { copy.textContent = 'Copy' }, 1500)
  })
  if (lines > PREVIEW_LINES + 1) {
    block.classList.add('demo-code-folded')
    const toggle = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Show code' })
    toggle.setAttribute('aria-expanded', 'false')
    toggle.addEventListener('click', () => {
      const open = block.classList.toggle('demo-code-open')
      toggle.textContent = open ? 'Hide code' : 'Show code'
      toggle.setAttribute('aria-expanded', String(open))
    })
    bar.append(toggle)
  }
  bar.append(copy)
  block.append(pre, bar)
  return block
}

/** An example's code as it reads, between its markers in its page's source. @param {string} source @param {string} name */
function sourceOf(source, name) {
  const lines = source.split('\n')
  const from = lines.findIndex((l) => l.trim() === `// ${name}`) + 1
  const to = lines.findIndex((l, i) => i > from && l.trim() === '// end')
  return lines.slice(from, to).join('\n')
}

/**
 * Sliders in a card's row: each a label, a range input and its value.
 * @param {HTMLElement} row
 */
function sliders(row) {
  return (/** @type {string} */ name, /** @type {number} */ min, /** @type {number} */ max, /** @type {number} */ value, /** @type {(v: number) => void} */ change, step = 0.05) => {
    const label = document.createElement('label')
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value })
    const shown = document.createElement('span')
    const say = () => { shown.textContent = String(+(+input.value).toFixed(2)) }
    say()
    input.addEventListener('input', () => {
      say()
      change(+input.value)
    })
    label.append(`${name} `, input, shown)
    row.append(label)
    // handed back, so a card can change its range
    return input
  }
}
