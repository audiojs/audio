// WORKSHOP: variants to choose between, a strip under the page, each choice kept in this browser and sent to the page
// (`apply`). Temporary: the ones chosen become the page's own, and the strip goes.
//   end       where the sound ends, past which the picture scrolls: a line down the lanes, the room past it hatched, a
//             dotted line, or nothing in the lanes, the time row's ticks stopping there
//   grid      how the lanes are ruled, behind the waveform (hidden where it is), over the spectrogram: a cross where the
//             time row's ticks meet the axis' on the right, a dot where their finer steps meet (0.1, 0.2 … 0.9 of full
//             scale; a fifth of the time row's step); the crosses alone; a dot at each, the ticks' larger; or none
// Chosen and settled: 2 px before the meters, no fade where the sound runs past the view, dark squares with no rim,
// notched beside their lines, square, crop in the context menu and K (a handle is dragged; crop is only clicked), the
// length after the time between bars |t|, undo and redo, then the picture's switch, then its settings at the head of its axis,
// none moving as it turns, the panels' buttons at the slab's top right, the edits a panel of its own, the panel docked,
// a rule at its edge in the slab's rule colour as far from its content as that is from the slab's edge, the export's
// arrow down onto a tray, how a held caret sounds in the settings, the switches as raised keys in one bezel (skeuo), the
// view's options from a right-click on its tab, two sliders for the settings, a spark for the agent, an open book for
// the recipes, the speed a pill in the record button's place while it plays, and round Play a ring, how far through the
// sound it plays
const CHOICES = {
  end: [['line', 'Line'], ['hatch', 'Hatch'], ['dots', 'Dots'], ['ruler', 'Ruler']],
  grid: [['marks', 'Crosses + dots'], ['crosses', 'Crosses'], ['dots', 'Dots'], ['none', 'None']]
}
const NAMES = { end: 'End', grid: 'Grid' }
const KEY = 'audio-repl-workshop'

export default function workshop(root, apply) {
  let chosen = Object.fromEntries(Object.entries(CHOICES).map(([key, list]) => [key, list[0][0]]))
  // a choice kept from before is kept only while it is still one of the choices
  try { for (const [key, value] of Object.entries(JSON.parse(localStorage.getItem(KEY)) || {})) if (CHOICES[key]?.some(([v]) => v === value)) chosen[key] = value } catch {}
  function render() {
    root.replaceChildren(...Object.entries(CHOICES).map(([key, list]) => {
      const group = document.createElement('div')
      group.className = 'workshop-group'
      group.append(Object.assign(document.createElement('span'), { textContent: NAMES[key] }))
      for (const [value, label] of list) {
        const b = group.appendChild(Object.assign(document.createElement('button'), { type: 'button', textContent: label, title: `${NAMES[key]}: ${label}` }))
        b.setAttribute('aria-pressed', String(chosen[key] === value))
        b.addEventListener('mousedown', event => event.preventDefault())
        b.addEventListener('click', () => { chosen = { ...chosen, [key]: value }; try { localStorage.setItem(KEY, JSON.stringify(chosen)) } catch {} ; render() })
      }
      return group
    }))
    apply(chosen)
  }
  render()
}
