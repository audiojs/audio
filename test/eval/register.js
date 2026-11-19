// Registers the candidate hook (candidate.js) for this thread: test/eval.js runs itself under --import of this module, so
// the workers a run starts register it too
import { register } from 'node:module'

register(new URL('./candidate.js', import.meta.url), { data: JSON.parse(process.env.AUDIO_EVAL_CANDIDATES) })
