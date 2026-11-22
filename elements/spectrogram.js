// <audio-spectrogram>: its sound's spectrogram (picture.js: a lane a channel, the place it plays on it, a press to go
// there), drawn by gl-spectrogram as the editor's view draws its own, computed on the GPU as it draws. In the
// element's `color`, the loudest level's, over its ground (the page's under it is read once; `background` names
// another); `scale`: log (default), mel, erb or lin.
import { Picture } from './picture.js'

// the colour a page shows under an element: the first box from it up that paints one of its own
const clear = c => !c || c === 'transparent' || /,\s*0\)$|\/\s*0\)$/.test(c)
function ground(el) {
  for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (!clear(c)) return c }
  return 'white'
}

class AudioSpectrogram extends Picture {
  renderer() { return import('../assets/gl-spectrogram.js').then(m => m.default) }
  options(style) { return { color: style.color, background: this.getAttribute('background') || ground(this), scale: this.getAttribute('scale') || 'log' } }
  summarize(lane, piece, c) { if (piece.spectra) lane.spectra(piece.spectra.levels[c], piece.spectra) }
}
if (!customElements.get('audio-spectrogram')) customElements.define('audio-spectrogram', AudioSpectrogram)
