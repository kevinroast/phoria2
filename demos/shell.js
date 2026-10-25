// Small helpers shared by the demos.

const fpsEl = () => document.getElementById('fps')

// Run `frame(time)` every animation frame. Escape toggles pause, as in the v1 demos.
// Returns a controller: { paused, stop() }.
export function animate(frame) {
  const control = { paused: false, stopped: false, stop() { this.stopped = true } }
  let frames = 0, last = performance.now()

  const onKey = (e) => {
    if (e.key === 'Escape') control.paused = !control.paused
  }
  document.addEventListener('keydown', onKey)

  const tick = (time) => {
    if (control.stopped) {
      document.removeEventListener('keydown', onKey)
      return
    }
    if (!control.paused) {
      frame(time)
      frames++
    }
    if (time - last >= 500) {
      const el = fpsEl()
      if (el) el.textContent = control.paused ? 'paused' : `${Math.round(frames * 1000 / (time - last))} fps`
      frames = 0
      last = time
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  return control
}

// Point a scene's perspective and viewport at the canvas size, and keep them matched as the
// window (and so the canvas) resizes.
export function fitScene(scene, canvas) {
  const fit = () => {
    scene.perspective.aspect = canvas.width / canvas.height
    scene.viewport.width = canvas.width
    scene.viewport.height = canvas.height
  }
  window.addEventListener('resize', fit)
  fit()
}
