import { popEdit } from '../history.js'

export default (audio) => {
  /** Pop edit(s). n=1 returns single edit or null; n>1 returns array. */
  audio.fn.undo = function(n = 1) {
    if (!this.edits.length) return n === 1 ? null : []
    let removed = []
    for (let i = 0; i < n && this.edits.length; i++) removed.push(popEdit(this))
    return n === 1 ? removed[0] : removed
  }
}
