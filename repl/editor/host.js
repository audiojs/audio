// Embedded, the sound said to the page that holds the frame, and what that page asks of it: <audio-repl> (embed.js) is
// a sound to the page's own parts, as <audio-sound> is (elements/sound.js): a play button, a clock, a code block of the
// page's name it (`for`), and it answers them through here.
//
// Said, each as it changes (read off the page's state twenty times a second: nothing here is in the editor's way, and a
// frame scrolled out of sight goes on saying it, where its frames are not drawn):
//   { audio: 'code', code, opens, saves }    its script, and the files it opens and saves, by name
//   { audio: 'state', playing, working, status, error, duration, time }
// Asked:
//   { audio: 'code', code }     its script whole, one step of its history; the same text asks nothing
//   { audio: 'play' | 'pause' | 'toggle' }
//   { audio: 'seek', time }     s
//   { audio: 'save' }           what the script saves, or the output, as Export makes it
//   { audio: 'file', file }     a File of the reader's own, opened as one dropped on the frame
import { files } from '../code.js'
import { library } from '../library.js'
import { EMBED, SAMPLES } from './config.js'
import { state, ed, pl, v } from './context.js'
import { togglePlay } from './play.js'
import { openFiles, exportFiles } from './files.js'

if (EMBED && parent !== window) {
  const say = message => parent.postMessage(message, '*')
  let code = null, said = ''
  setInterval(() => {
    // (the boot not yet through: the state, the script's editor and the view are assigned as it goes)
    if (!state || !ed || !v) return
    const now = ed.code
    if (now !== code) {
      code = now
      const f = files(now)
      say({ audio: 'code', code, opens: f.opens.map(x => x.name), saves: f.saves.map(x => x.name) })
      // a script that opens the site's own file may open one of the catalogue's recordings: the catalogue asked for,
      // so the sound is said by its word and credited by its line there (readouts.js), as one opened from the menu is
      if (SAMPLES && f.opens.some(x => /^\/(?!\/)/.test(x.name))) library(SAMPLES).then(() => { state.heardKinds = { ...state.heardKinds } })
    }
    const s = {
      playing: !!state.playing, working: !!(state.working || state.exporting),
      status: state.exporting ? 'Saving' : [state.progress, state.figure].filter(Boolean).join(' '), error: state.problem || '',
      duration: state.hasOutput ? v.duration : 0, time: state.playing ? v.playhead ?? pl?.time ?? 0 : v.cursor ?? 0
    }
    const key = JSON.stringify(s)
    if (key !== said) { said = key; say({ audio: 'state', ...s }) }
  }, 50)
  addEventListener('message', e => {
    if (e.source !== parent || !ed) return
    const m = e.data
    if (m?.audio === 'code' && typeof m.code === 'string' && m.code !== ed.code) ed.change({ from: 0, to: ed.code.length, insert: m.code })
    if (m?.audio === 'toggle' || m?.audio === 'play' && !state.playing || m?.audio === 'pause' && state.playing) togglePlay()
    if (m?.audio === 'seek' && Number.isFinite(m.time)) { const t = Math.max(0, Math.min(m.time, v.duration)); state.playing ? pl.seek(t) : v.setCursor(t) }
    if (m?.audio === 'save') exportFiles()
    if (m?.audio === 'file' && m.file instanceof Blob) openFiles([m.file])
  })
}
