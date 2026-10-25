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

// Size the canvas to fill the window and keep it that way. Calls onResize(width, height) now and
// on every window resize.
export function fullscreenCanvas(canvas, onResize) {
  document.body.classList.add('fullscreen')
  const resize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
    onResize?.(canvas.width, canvas.height)
  }
  window.addEventListener('resize', resize)
  resize()
}

// Point a scene's perspective and viewport at the canvas size.
export function fitScene(scene, canvas) {
  scene.perspective.aspect = canvas.width / canvas.height
  scene.viewport.width = canvas.width
  scene.viewport.height = canvas.height
}

// Add the camera/perspective folders most v1 demos had in their dat.GUI panel.
export function addCameraControls(gui, scene, { lookatOpen = true, positionOpen = true } = {}) {
  let f = gui.addFolder('Perspective').close()
  f.add(scene.perspective, 'fov', 5, 175)
  f.add(scene.perspective, 'near', 1, 100)
  f.add(scene.perspective, 'far', 1, 1000)
  f = gui.addFolder('Camera LookAt')
  f.add(scene.camera.lookat, 'x', -100, 100)
  f.add(scene.camera.lookat, 'y', -100, 100)
  f.add(scene.camera.lookat, 'z', -100, 100)
  if (!lookatOpen) f.close()
  f = gui.addFolder('Camera Position')
  f.add(scene.camera.position, 'x', -100, 100)
  f.add(scene.camera.position, 'y', -100, 100)
  f.add(scene.camera.position, 'z', -100, 100)
  if (!positionOpen) f.close()
}
