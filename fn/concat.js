import audio from '../core.js'
import './view.js'
import './insert.js'

/** Concatenate other audio sources after this one. Returns a new instance. */
audio.fn.concat = function(...sources) {
  let result = this.view()
  for (let src of sources) result.insert(src)
  return result
}
