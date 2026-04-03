const gain = (db) => (chs, { offset, duration, sampleRate: sr }) => {
  let f = 10 ** (db / 20)
  let s = offset != null ? Math.round(offset * sr) : 0
  let end = duration != null ? s + Math.round(duration * sr) : chs[0].length
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = s; i < Math.min(end, o.length); i++) o[i] *= f
    return o
  })
}

export default (audio) => { audio.op('gain', gain) }
