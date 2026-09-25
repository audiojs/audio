import audio from '../core.js'
import './copy.js'
import './remove.js'

// Capture and remove in one edit so Undo also restores the previous clipboard.
audio.op('cut', { params: ['at', 'duration', 'crossfade'], plan: audio.op('remove').plan })
