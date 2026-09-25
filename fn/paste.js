import audio from '../core.js'
import './copy.js'

audio.op('paste', { params: ['at', 'crossfade'], plan: audio.op('insert').plan })
