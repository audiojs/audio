// What the editor's parts share: the page's state, the engine, the view, the script's editor and its edits, and each
// binding more than one part writes. Read live where imported; written through assign(), here alone

// the page's state (sprae), the engine and the view, each made once by the boot (editor.js) and assigned here
let state, eng, v
// the script's editor (script.js) and its edits (stack.js), swapped for a moment by spread()
let ed, rk
// the shown tab's player (switchTab)
let pl = null
// the whole output the page has; the newest run's output as it arrives; the run whose output the view shows
let output = null, incoming = null, showing = 0
// the run waiting to start (schedule)
let timer = 0
// the next run is one a mute asks (perform)
let hush = false
// the script after each step of its history (remember), and how many steps back it was last
let steps = [], depthWas = 0
// the card of the edits an undo or a redo brings back to, once the edits have seen the script it brings back (remember)
let rechoose
// what the output shows when not the whole chain (the stack): what live step `delta` takes out, or the chain rolled
// back to its first `back` steps
let viewing = { delta: null, back: null }
// The agent's last edit, drawn over the output while the script is as it left it (showEdit): { code, guides }
let shown = null, carded = false
// The notes each lane showing them holds (view.js notes), a voice's, found once its output is whole (worker.js notes); set
// again only as the output or the lanes showing them change
let notesFor = ''
// the edits asked while one is still being made over the picture, each made once the one before it is (view.js onbusy)
let queued = []

// The writes from outside, by name: assign({ output: out, incoming: null })
const set = {
  state: x => state = x, eng: x => eng = x, v: x => v = x, ed: x => ed = x, rk: x => rk = x, pl: x => pl = x,
  output: x => output = x, incoming: x => incoming = x, showing: x => showing = x, timer: x => timer = x, hush: x => hush = x,
  steps: x => steps = x, depthWas: x => depthWas = x, rechoose: x => rechoose = x, viewing: x => viewing = x,
  shown: x => shown = x, carded: x => carded = x, notesFor: x => notesFor = x, queued: x => queued = x
}
export function assign(o) { for (const k in o) set[k](o[k]) }

// (no `export let`: tests patch these declarations' text, test/playground/)
export { state, eng, v, ed, rk, pl, output, incoming, showing, timer, hush, steps, depthWas, rechoose, viewing, shown, carded, notesFor, queued }
