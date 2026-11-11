// defines the <phoria-view> tag - every one in the page starts drawing
import 'phoria2/element'

const chair = document.querySelector('#chair')
const night = document.querySelector('#night'), paper = document.querySelector('#paper')

// attributes change the view as they change - the model stays loaded
night.addEventListener('click', () => {
  const dark = chair.getAttribute('exposure') !== '0.4'
  chair.setAttribute('exposure', dark ? '0.4' : '1')
  chair.setAttribute('environment-intensity', dark ? '0.25' : '1')
  night.textContent = dark ? 'Day' : 'Night'
})
paper.addEventListener('click', () => {
  const light = !chair.hasAttribute('background')
  if (light) chair.setAttribute('background', '#e9e6df')
  else chair.removeAttribute('background')
  paper.textContent = light ? 'Dark' : 'Paper'
})
