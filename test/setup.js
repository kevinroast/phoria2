// Every test file starts with all the GLSL parts registered (src/webgl/parts.js), as if each had
// loaded, and the labels' code in place (labelSlot.js): the tests check the shaders, what a frame
// draws and the labels it shows, not when code arrives - which lazy-parts.test.js does.
import { SHADOW_PARTS } from '../src/webgl/parts-shadows.js'
import { RECT_PARTS } from '../src/webgl/parts-rect.js'
import { MATERIAL_PARTS } from '../src/webgl/parts-materials.js'
import { HOOK_PARTS } from '../src/webgl/parts-hooks.js'
import { addParts } from '../src/webgl/parts.js'
import { LabelLayer } from '../src/labels.js'
import { labelSlot } from '../src/labelSlot.js'

addParts('shadows', SHADOW_PARTS)
addParts('rect', RECT_PARTS)
addParts('materials', MATERIAL_PARTS)
addParts('hooks', HOOK_PARTS)
labelSlot.module = { LabelLayer }
