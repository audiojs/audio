/** Per-block minimum amplitude. */
export default () => (channels) => channels.map(ch => {
  let mn = Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] < mn) mn = ch[i]
  return mn
})
