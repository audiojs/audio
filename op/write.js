export default (data) => (chs, { offset = 0, sampleRate: sr }) => {
  let p = Math.round(offset * sr)
  return chs.map((ch, c) => {
    let o = new Float32Array(ch)
    let s = Array.isArray(data) ? (data[c] || data[0]) : data
    for (let i = 0; i < s.length && p + i < o.length; i++) o[p + i] = s[i]
    return o
  })
}
