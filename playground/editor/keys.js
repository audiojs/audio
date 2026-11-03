import { pressed } from './commands.js'
import { root } from './config.js'
import { pl } from './context.js'
import { closeMenus } from './menus.js'

// The page's keys and presses: Esc, the commands' keys, the focus a press gives, the audio device opened on the first
// touch

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
  // The page's keys: the commands' (commands.js), where they are pressed
  document.addEventListener('keydown', event => {
    const c = pressed(event)
    if (!c) return
    event.preventDefault()
    c.run(event)
  })
  // Buttons around the picture act without taking focus: Space stays play, and the picture or the script keeps its keys
  root.addEventListener('mousedown', event => { if (event.target.closest('.status button, .tabs button, .history button, .panel-head button, .files button, .add-step, .viewing')) event.preventDefault() })
  // A press in it gives it the keys, whatever took it: embedded, a frame a press doesn't focus (a button kept from taking
  // focus, as above) would leave Space to the page around it, and miss leaving when the next press is there (blur)
  addEventListener('pointerdown', () => document.hasFocus() || window.focus(), true)
  // The first touch of the page opens the audio device, so the first play starts at once
  for (const type of ['pointerdown', 'keydown']) addEventListener(type, () => pl.warm(), { capture: true, once: true })
}
