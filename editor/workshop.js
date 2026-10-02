// WORKSHOP: variants to choose between, a strip under the page, each choice kept in this browser and sent to the page
// (`apply`). Temporary: the ones chosen become the page's own, and the strip goes.
//   settings  the settings' icon: three sliders with round thumbs, or two
//   recipes   the recipes' icon: a recipe book open, a flask, a wand with its spark
//   agent     the agent's: a chat with a spark in it, sparks alone, a small robot
//   resizer   the panel's edge, dragged for its width: a bar on it, three dots, a pill with a grip (an iPad's split), a
//             Finder column's divider (a rule, its knob at the foot), or nothing until it is pointed at
//   end       where the sound ends, past which the picture scrolls: a line, the room past it shaded, hatched, a cap on
//             the time row, or a tag saying so
//   speed     how the speed shows by Play (set by Play held and dragged, or its right-click list): a readout once it is
//             not 1× (a click, 1× again), a pill turning 1×, 1.5×, 2× as a messenger's voice notes do, a slider, or a
//             ring round Play
// Chosen and settled: 2 px before the meters, no fade where the sound runs past the view, dark squares with no rim,
// notched beside their lines, square, crop in the context menu and K (a handle is dragged; crop is only clicked), the
// length after the time between bars |t|, undo and redo, then the picture's switch, then its settings over its meter,
// none moving as it turns, the panels' buttons at the slab's top right, the edits a panel of its own, the panel docked with no
// line between, the export's arrow down onto a tray, how a held caret sounds in the settings, the switches as raised keys
// in one bezel (skeuo), the view's options from a right-click on its tab
const CHOICES = {
  settings: [['three', '3 sliders'], ['two', '2 sliders']],
  recipes: [['book', 'Book'], ['flask', 'Flask'], ['wand', 'Wand']],
  agent: [['spark', 'Chat spark'], ['sparks', 'Sparks'], ['bot', 'Bot']],
  resizer: [['bar', 'Bar'], ['dots', 'Dots'], ['pill', 'Pill'], ['finder', 'Finder'], ['none', 'None']],
  end: [['line', 'Line'], ['shade', 'Shade'], ['hatch', 'Hatch'], ['cap', 'Cap'], ['tag', 'Tag']],
  speed: [['readout', 'Readout'], ['pill', 'Pill'], ['slider', 'Slider'], ['ring', 'Ring']]
}
const NAMES = { settings: 'Settings icon', recipes: 'Recipes icon', agent: 'Agent icon', resizer: 'Panel edge', end: 'End', speed: 'Speed' }
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
