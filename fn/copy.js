import audio from '../core.js'
import './crop.js'
import './insert.js'

// Clipboard operations remain in the edit list; the planner captures their input.
audio.op('copy', { params: ['at', 'duration'] })
