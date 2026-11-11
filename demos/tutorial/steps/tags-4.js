// defines the <phoria-view> tag - every one in the page starts drawing
import 'phoria2/element'

const sales = document.querySelector('#sales')

// a click is a 'pick' event: its hit's datum is the row behind the bar, or null for empty space
sales.addEventListener('pick', (/** @type {CustomEvent} */ e) => {
  const row = e.detail.hit?.datum
  document.querySelector('#said').textContent = row ? `${row.region}, ${row.month}: ${row.sales}` : 'Click a bar'
})

// once the content has loaded, the tag's View is there for the rest - here the chart, found by
// its name, gets new figures every two seconds
sales.addEventListener('load', (/** @type {CustomEvent} */ e) => {
  const chart = e.detail.view.scene.find('sales')
  setInterval(() => {
    chart.update(chart.data.map((row) => ({ ...row, sales: Math.round(20 + 30 * Math.random()) })))
  }, 2000)
})
