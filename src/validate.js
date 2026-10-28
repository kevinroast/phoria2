// Validation helpers. Options and descriptions are checked once, when an object is created or a
// property set - never per frame - and errors name the object, the problem and the fix.

/** Error thrown for invalid phoria2 input. Its message always says what to do instead. */
export class PhoriaError extends Error {
  name = 'PhoriaError'
}

/**
 * Throw a PhoriaError: `${owner}: ${message}`.
 * @param {string} owner the object or function the input was for, e.g. 'Mesh' or 'box()'
 * @param {string} message
 * @returns {never}
 */
export function fail(owner, message) {
  throw new PhoriaError(`${owner}: ${message}`)
}

// Edit distance where swapping two neighbouring letters counts as one edit ('widht' -> 'width'),
// for did-you-mean suggestions.
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/**
 * The closest candidate to a mistyped name, or undefined if nothing is close.
 * @param {string} name
 * @param {Iterable<string>} candidates
 * @returns {string | undefined}
 */
export function suggest(name, candidates) {
  const lower = name.toLowerCase()
  // a list, since an iterator could only be read once
  const list = [...candidates]
  // an abbreviation that only one candidate starts with ('w' -> 'width')
  const prefixed = list.filter((c) => c.toLowerCase().startsWith(lower))
  if (prefixed.length === 1) return prefixed[0]
  let best, bestScore = Infinity
  for (const c of list) {
    const score = c.toLowerCase() === lower ? 0 : distance(lower, c.toLowerCase())
    if (score < bestScore) {
      best = c
      bestScore = score
    }
  }
  // allow roughly one edit per three characters
  return bestScore <= Math.max(1, Math.floor(name.length / 3)) ? best : undefined
}

/** " - did you mean 'x'?" or an empty string. @param {string} name @param {Iterable<string>} candidates */
export const didYouMean = (name, candidates) => {
  const s = suggest(name, candidates)
  return s ? ` - did you mean '${s}'?` : ''
}

/**
 * Check an options object only uses known keys. Known three.js-isms can map to a targeted hint.
 * @param {string} owner
 * @param {object} options
 * @param {Iterable<string>} known
 * @param {Record<string, string>} [hints] option name -> message for common mistakes
 * @param {string} [name] the option these are, when nested (e.g. 'framing'), so errors say which
 */
export function checkOptions(owner, options, known, hints = {}, name) {
  if (options == null) return
  const keys = new Set(known)
  if (typeof options !== 'object' || Array.isArray(options)) {
    const expected = name ? `'${name}' must be an options object - { ${[...keys].join(', ')} }` : 'expected an options object'
    fail(owner, `${expected}, got ${describe(options)}`)
  }
  for (const key of Object.keys(options)) {
    if (keys.has(key)) continue
    if (hints[key]) fail(owner, hints[key])
    fail(owner, `unknown option '${name ? `${name}.${key}` : key}'${didYouMean(key, keys)}`)
  }
}

/** A short description of a value for error messages. @param {unknown} v @returns {string} */
export function describe(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `an array of ${v.length}`
  if (typeof v === 'string') return `'${v}'`
  if (typeof v === 'object') return v.constructor?.name && v.constructor !== Object ? `a ${v.constructor.name}` : 'an object'
  return String(v)
}

/** @param {string} owner @param {string} name @param {unknown} v @returns {number} */
export function checkNumber(owner, name, v) {
  if (typeof v !== 'number' || Number.isNaN(v)) fail(owner, `'${name}' must be a number, got ${describe(v)}`)
  return v
}

/**
 * A number within limits: from min (or above it, with above: true) up to max.
 * @param {string} owner @param {string} name @param {unknown} v
 * @param {number} [min] @param {number} [max] @param {{ above?: boolean }} [options]
 * @returns {number}
 */
export function checkRange(owner, name, v, min = -Infinity, max = Infinity, { above = false } = {}) {
  const n = checkNumber(owner, name, v)
  if ((above ? !(n > min) : n < min) || n > max) {
    const limits = max === Infinity ? (above ? `above ${min}` : `${min} or more`) : above ? `above ${min} and up to ${max}` : `from ${min} to ${max}`
    fail(owner, `'${name}' must be ${limits}, got ${n}`)
  }
  return n
}

/**
 * @template {string} T
 * @param {string} owner @param {string} name @param {unknown} v @param {readonly T[]} allowed
 * @returns {T}
 */
export function checkOneOf(owner, name, v, allowed) {
  if (!allowed.includes(/** @type {T} */ (v))) {
    const hint = typeof v === 'string' ? didYouMean(v, allowed) : ''
    fail(owner, `'${name}' ${describe(v)} is not valid - expected ${allowed.map((a) => `'${a}'`).join(' | ')}${hint}`)
  }
  return /** @type {T} */ (v)
}

const warned = new WeakMap()
/**
 * console.warn once per object and message - for problems that would otherwise repeat every frame.
 * @param {object} target @param {string} message
 */
export function warnOnce(target, message) {
  let seen = warned.get(target)
  if (!seen) warned.set(target, seen = new Set())
  if (seen.has(message)) return
  seen.add(message)
  console.warn(`phoria2: ${message}`)
}
