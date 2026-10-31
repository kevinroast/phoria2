// Runs one tutorial step in its own page - the frame beside the step's code - in the markup the
// step brings, as a reader's copy of it would run.
import { MODULES, markupFor } from './steps.js'

const name = new URLSearchParams(location.search).get('step') ?? ''
if (!MODULES[name]) throw new Error(`tutorial: no step '${name}'`)
document.body.innerHTML = markupFor(name)
MODULES[name]()
