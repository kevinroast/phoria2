// phoria2/edit: what editors need on top of the core's dragging, rays and outlines - a handle to
// move and turn what is selected, snapping to a grid and to angles, and undo. Outside the core, so
// apps that only show things don't carry it.
export { TransformHandle } from './TransformHandle.js'
export { History } from './History.js'

/** @typedef {import('./TransformHandle.js').TransformHandleOptions} TransformHandleOptions */
/** @typedef {import('./TransformHandle.js').Placement} Placement */
/** @typedef {import('./History.js').HistoryOptions} HistoryOptions */
/** @typedef {import('./History.js').HistoryEntry} HistoryEntry */
