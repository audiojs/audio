const mix = (source) => (chs, { offset, duration, sampleRate: sr, render }) => {
  let p = offset != null ? Math.round(offset * sr) : 0, src = render(source)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch), m = src[c] || src[0]
    let n = duration != null ? Math.round(duration * sr) : m.length
    for (let i = 0; i < Math.min(n, m.length) && p + i < o.length; i++) o[p + i] += m[i]
    return o
  })
}

export default (audio) => { audio.op('mix', mix) }
