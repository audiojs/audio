import { root } from './config.js'
import { state, rk, pl } from './context.js'
import { editSelection } from './edits.js'
import { pickFiles, exportFiles } from './files.js'
import { openTools, closeMenus } from './menus.js'
import { toggleAB, toggleLoop, togglePlay } from './play.js'
import { retakeHere, startRecording, stopRecording } from './recording.js'
import { reopenTab } from './tabs.js'
import { addMarker } from './writers.js'

// The page's keys and presses: Esc, the single keys (B M K L R Space), ⌘'s, the focus a press gives, the audio device
// opened on the first touch

export function wire() {
  // Esc closes an open menu and does nothing else: the selection under it stays. A menu that has the keys (the menubar's)
  // closes itself
  document.addEventListener('keydown', event => {
    const open = event.key === 'Escape' && !event.target.closest?.('[popover], .menubar') && root.querySelector('[popover]:popover-open')
    if (!open) return
    event.preventDefault()
    event.stopPropagation()
    open.hidePopover()
  }, true)
  // The window left (another app; embedded, a press on the page around it): whatever is open over the page closes, its
  // menus, lists and a look's dropdown, as on a press outside them (menu.js closes its own)
  addEventListener('blur', closeMenus)
  document.addEventListener('keydown', event => {
    const mod = event.metaKey || event.ctrlKey, typing = event.target.closest?.('.cm-editor, input, textarea, select, dialog')
    if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'b' && state.whole) { event.preventDefault(); toggleAB() }
    else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'm' && state.whole) { event.preventDefault(); addMarker() }
    else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'k' && state.selection && !state.band) { event.preventDefault(); editSelection('crop') }
    else if (!typing && !mod && !event.altKey && event.key.toLowerCase() === 'l' && state.whole) { event.preventDefault(); toggleLoop() }
    else if (!typing && !mod && event.code === 'KeyR' && !state.playing && state.shuttle == null && !state.halting && !event.repeat) { event.preventDefault(); state.recording ? stopRecording() : event.altKey ? retakeHere() : startRecording(event.shiftKey && state.whole) }
    else if (event.key === ' ' && !typing && !event.target.closest('button, a')) { event.preventDefault(); state.recording ? stopRecording() : togglePlay() }
    else if (mod && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); reopenTab() }
    else if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); exportFiles() }
    else if (mod && event.key.toLowerCase() === 'o') { event.preventDefault(); pickFiles() }
    else if (mod && !event.shiftKey && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'p')) { event.preventDefault(); openTools() }
    // the edits picked made a group, or the group unmade (stack.js), but in a field being written
    else if (mod && event.key.toLowerCase() === 'g' && !event.target.closest?.('input, textarea, select, dialog')) { event.preventDefault(); event.shiftKey ? rk.ungroup() : rk.group() }
  })
  // Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
  root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .history button, .panel-head button, .files button, .add-step, .viewing')) event.preventDefault() })
  // A press in it gives it the keys, whatever took it: embedded, a frame a press doesn't focus (a button kept from taking
  // focus, as above) would leave Space to the page around it, and miss leaving when the next press is there (blur)
  addEventListener('pointerdown', () => document.hasFocus() || window.focus(), true)
  // The first touch of the page opens the audio device, so the first play starts at once
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
}
