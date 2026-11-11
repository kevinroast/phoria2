// Runs one tutorial step in its own page - the frame beside the step's code - in the markup the
// step brings, as a reader's copy of it would run.
import { MODULES, markupFor } from './steps.js'

const name = new URLSearchParams(location.search).get('step') ?? ''
if (!MODULES[name]) throw new Error(`tutorial: no step '${name}'`)
document.body.innerHTML = markupFor(name)
// the frame is sized to the code beside it, often a fraction of a pixel, and a step that fills its
// window (100vh) rounds a pixel over - enough for a scrollbar the frame never needs
document.documentElement.style.overflow = 'hidden'
MODULES[name]()
