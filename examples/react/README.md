# phoria2 with React

The smallest useful pattern for using phoria2 in a React app: two components, each a canvas that
phoria2 draws on.

- [`SpinningBox.jsx`](src/SpinningBox.jsx) - make the `View` once in an effect, `view.dispose()` in
  its cleanup, keep the nodes you'll change in refs, and change them in place when props change.
- [`SalesChart.jsx`](src/SalesChart.jsx) - a chart made once, then `chart.update(rows)` whenever
  new rows arrive in props; the bars animate to their new heights.
- [`App.jsx`](src/App.jsx) - plain React state driving both through props.

React owns the canvas element; phoria2 owns what is drawn on it. The scene is never rebuilt on a
render - only the nodes that a prop affects are touched. `StrictMode` is on, so in development
React mounts, disposes and mounts each component again to check the cleanup works.

## Run it

This example uses phoria2 from the folder above (`"phoria2": "file:../.."`), so build the library
first:

```sh
cd ../..          # the phoria2 folder
npm install
npm run build
cd examples/react
npm install
npm run dev
```

In your own app, `npm install phoria2` instead.
