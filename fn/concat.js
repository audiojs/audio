export default (audio) => {
  /** Concatenate other audio sources after this one. Returns a new instance. */
  audio.fn.concat = function(...sources) {
    let result = this.view()
    for (let src of sources) result.insert(src)
    return result
  }

  /** Static concat — convenience wrapper over instance method. */
  audio.concat = function(...sources) {
    if (!sources.length) throw new TypeError('audio.concat: expected at least one source')
    let first = audio.from(sources[0])
    return first.concat(...sources.slice(1))
  }
}
