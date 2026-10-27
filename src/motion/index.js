// phoria2/motion: timelines of named steps, moving things along curves and drawing curves in -
// for stories, explainers and guided tours. Outside the core, so apps that don't animate this way
// don't carry it. Curves themselves (curve(), ellipse()) are in the core.
export { Timeline } from './Timeline.js'
export { face, follow, reveal } from './follow.js'
export { EASES } from './ease.js'

/** @typedef {import('./Timeline.js').TimelineOptions} TimelineOptions */
/** @typedef {import('./Timeline.js').StepOptions} StepOptions */
/** @typedef {import('./follow.js').FollowOptions} FollowOptions */
/** @typedef {import('./follow.js').FaceOptions} FaceOptions */
/** @typedef {import('./follow.js').Forward} Forward */
/** @typedef {import('./ease.js').EaseName} EaseName */
