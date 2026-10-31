// node scripts/elements.mjs: make demos/data/elements.js, the periodic table demo's data, from
// PubChem's periodic table (https://pubchem.ncbi.nlm.nih.gov/periodic-table/ - NIH, US government
// work, public domain). Adds what the table needs that PubChem doesn't give directly: each
// element's place in the table, and its electrons per shell (from its configuration, with the noble
// gas cores spelled out). Run again to refresh; the output is committed, so the demo needs no network.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON'
const OUT = resolve(import.meta.dirname, '../demos/data/elements.js')

const table = (await (await fetch(SOURCE)).json()).Table
const columns = table.Column ?? table.Columns.Column
const rows = table.Row.map((r) => Object.fromEntries(columns.map((c, i) => [c, r.Cell[i]])))

// the noble gas cores configurations are written over
const CORES = { He: '1s2', Ne: '[He] 2s2 2p6', Ar: '[Ne] 3s2 3p6', Kr: '[Ar] 3d10 4s2 4p6', Xe: '[Kr] 4d10 5s2 5p6', Rn: '[Xe] 4f14 5d10 6s2 6p6' }
/** Electrons per shell, from a configuration such as '[Xe]6s2 5d1'. @param {string} config */
function shells(config) {
  let text = config.replace(/\(.*?\)/g, ' ')
  // spell out the cores, innermost last
  while (/\[(\w+)\]/.test(text)) text = text.replace(/\[(\w+)\]/, (_, gas) => ` ${CORES[gas]} `)
  const counts = []
  for (const [, n, , count] of text.matchAll(/(\d)([spdf])(\d+)/g)) counts[Number(n) - 1] = (counts[Number(n) - 1] ?? 0) + Number(count)
  return Array.from(counts, (c) => c ?? 0)
}

/** Where an element sits: its column (1-18) and row (1-7 for the periods, 9 and 10 for the f-block below). @param {number} z */
function place(z) {
  const period = z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7
  if (z >= 57 && z <= 71) return { period, col: 3 + z - 57, row: 9 }
  if (z >= 89 && z <= 103) return { period, col: 3 + z - 89, row: 10 }
  const first = [1, 3, 11, 19, 37, 55, 87][period - 1]
  const i = z - first
  let col
  if (period === 1) col = z === 1 ? 1 : 18
  else if (period <= 3) col = i < 2 ? i + 1 : i + 11
  else if (period <= 5) col = i + 1
  else col = i < 2 ? i + 1 : i - 14 + 1
  return { period, col, row: period }
}

const num = (v) => (v === '' || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))
const elements = rows.map((r) => {
  const z = Number(r.AtomicNumber)
  const { period, col, row } = place(z)
  return {
    number: z,
    symbol: r.Symbol,
    name: r.Name,
    mass: num(r.AtomicMass),
    category: r.GroupBlock,
    group: row <= 7 ? col : null,
    period,
    col,
    row,
    config: r.ElectronConfiguration.replace(/\s*\(.*?\)\s*/g, ''),
    shells: shells(r.ElectronConfiguration),
    electronegativity: num(r.Electronegativity),
    radius: num(r.AtomicRadius),
    ionisation: num(r.IonizationEnergy),
    melting: num(r.MeltingPoint),
    boiling: num(r.BoilingPoint),
    density: num(r.Density),
    state: r.StandardState,
    discovered: r.YearDiscovered === 'Ancient' ? 'ancient' : num(r.YearDiscovered),
  }
})

// a check that the shells add up to the atomic number - a configuration misread would show here
for (const e of elements) {
  const total = e.shells.reduce((a, b) => a + b, 0)
  if (total !== e.number) throw new Error(`${e.symbol}: shells ${e.shells.join(',')} add up to ${total}, not ${e.number}`)
}

writeFileSync(OUT, `// The 118 elements, from PubChem's periodic table (NIH, public domain) - made by scripts/elements.mjs.
// Units: mass in u, radius in pm, ionisation energy in eV, melting and boiling points in K, density in
// g/cm3. null where PubChem has no value. row 9 and 10 are the lanthanides and actinides, set below.
export const ELEMENTS = ${JSON.stringify(elements, null, 0).replace(/\},\{/g, '},\n  {').replace(/^\[\{/, '[\n  {').replace(/\}\]$/, '},\n]')}
`)
console.log(`wrote ${elements.length} elements to ${OUT}`)
