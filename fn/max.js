/** Per-block maximum amplitude. */
const max = () => (channels) => channels.map(ch => {
  let mx = -Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] > mx) mx = ch[i]
  return mx
})

export default (audio) => { audio.stat('max', max) }
