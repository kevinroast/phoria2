// npm run plugin: copy the reference and the JSON schemas into the Claude Code plugin. An installed
// plugin can't read outside its own folder, so it carries copies; test/claude-plugin.test.js fails
// when they fall behind.
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..'), refs = resolve(root, 'claude-plugin/skills/phoria2/references')
copyFileSync(resolve(root, 'llms-full.txt'), resolve(refs, 'llms-full.txt'))
copyFileSync(resolve(root, 'schema/chart.schema.json'), resolve(refs, 'chart.schema.json'))
copyFileSync(resolve(root, 'schema/scene.schema.json'), resolve(refs, 'scene.schema.json'))
console.log('claude-plugin references updated')
