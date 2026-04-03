/** Per-block maximum amplitude. */
export default () => (channels) => channels.map(ch => {
  let mx = -Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] > mx) mx = ch[i]
  return mx
})
