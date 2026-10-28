// The Claude Code plugin carries its own copies of the reference and the chart schema (an installed
// plugin can't read outside its folder): they must match the originals. `npm run plugin` copies them.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const skill = 'claude-plugin/skills/phoria2/'

describe('claude plugin', () => {
  it('has the current reference and chart schema - run `npm run plugin` if not', () => {
    expect(read(`${skill}references/llms-full.txt`) === read('llms-full.txt')).toBe(true)
    expect(read(`${skill}references/chart.schema.json`) === read('schema/chart.schema.json')).toBe(true)
  })

  it('names the skill after its folder, with a description short enough for every agent', () => {
    const front = read(`${skill}SKILL.md`).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
    expect(front.match(/^name: (.*)$/m)?.[1]).toBe('phoria2')
    expect(front.match(/^description: (.*)$/m)?.[1].length).toBeLessThanOrEqual(1024)
    const market = JSON.parse(read('.claude-plugin/marketplace.json')), plugin = JSON.parse(read('claude-plugin/.claude-plugin/plugin.json'))
    expect([market.plugins[0].source, plugin.name]).toEqual(['./claude-plugin', 'phoria2'])
  })
})
