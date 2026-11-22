// <audio-wave>: its sound's waveform (picture.js: a lane a channel, the place it plays on it, a press to go there),
// drawn by gl-waveform as the editor's view draws its own: zoomed out, each pixel column the exact extremes of its
// samples, their RMS a band inside. In the element's `color`.
import { Picture } from './picture.js'

class AudioWave extends Picture {
  renderer() { return import('../assets/gl-waveform.js').then(m => m.default) }
  options(style) { return { color: style.color } }
  summarize(lane, piece, c) { lane.peaks(piece.peaks[c], piece.at) }
}
if (!customElements.get('audio-wave')) customElements.define('audio-wave', AudioWave)
