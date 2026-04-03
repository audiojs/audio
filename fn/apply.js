export default (audio) => {
  /** Re-apply edits. Accepts edit objects or inline functions. */
  audio.fn.apply = function(...edits) {
    for (let e of edits) {
      if (typeof e === 'function') this.edits.push({ type: '_fn', fn: e })
      else if (Array.isArray(e.args)) this.edits.push(e)
      else throw new TypeError('audio.apply: edit must have args array')
      this.version++
      this.onchange?.()
    }
    return this
  }
}
