// The library's own CSS - labels, tooltips, the keyboard's screen-reader text, charts' HTML, the
// <phoria-view> tag - each added to the page once, the first time it is needed. Prepended to <head>,
// so the page's own rules, coming later, win over anything they tie with (and the rules are :where()
// rules, with no specificity, so any rule of the page's for the same classes wins).

/**
 * Add a style sheet to the page once: nothing if one with this id is there already, or there is no page.
 * @internal @param {string} id @param {string} css
 */
export function addStyle(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = css
  document.head.prepend(style)
}
