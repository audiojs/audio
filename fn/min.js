/** Per-block minimum amplitude. */
const min = () => (channels) => channels.map(ch => {
  let mn = Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] < mn) mn = ch[i]
  return mn
})

export default (audio) => { audio.stat('min', min) }
