// A playback session owns its gain and every scheduled source, including future ones.
export default function output(context, onempty) {
  const gain = context.createGain(), nodes = new Set(), ramp = .004
  let began, closed = false
  gain.gain.value = 0
  gain.connect(context.destination)
  return {
    get size() { return nodes.size },
    start(node, at, ...args) {
      if (closed) return
      if (began == null) {
        began = at
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(1, at + ramp)
      }
      node.connect(gain)
      node.onended = () => {
        nodes.delete(node)
        node.disconnect()
        if (!nodes.size) {
          if (closed) gain.disconnect()
          else onempty()
        }
      }
      try { node.start(at, ...args) }
      catch (error) { node.disconnect(); throw error }
      nodes.add(node)
    },
    stop() {
      if (closed) return
      closed = true
      const now = context.currentTime
      const level = began == null ? 0 : Math.max(0, Math.min(1, (now - began) / ramp))
      const end = now + (level ? ramp : 0)
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(level, now)
      gain.gain.linearRampToValueAtTime(0, end)
      // Stop every source on the same clock, after the short release reaches silence.
      for (const node of nodes) node.stop(end)
      if (!nodes.size) gain.disconnect()
    }
  }
}
