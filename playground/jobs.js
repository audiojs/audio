// The engine's threads (parallel.js): each makes the jobs it is handed, by the kernels named here, imported as they
// are, a worker having no import maps. Built beside the engine into playground/dist/ (node .site-build.js)
import { serve } from '../parallel.js'
import * as declip from '@audio/denoise/declip'

serve(mod => ({ '@audio/denoise/declip': declip })[mod])
