export const GATE_WINDOW = 0.4

const ABS_GATE = -70
const REL_GATE = -10
const LUFS_OFFSET = -0.691

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function lufsFromMeanSquares(meanSquares) {
  let absoluteThreshold = 10 ** (ABS_GATE / 10)
  let absoluteGated = meanSquares.filter(value => value > absoluteThreshold)
  if (!absoluteGated.length) return null

  let relativeThreshold = mean(absoluteGated) * 10 ** (REL_GATE / 10)
  let relativeGated = absoluteGated.filter(value => value > relativeThreshold)
  if (!relativeGated.length) return null

  return LUFS_OFFSET + 10 * Math.log10(mean(relativeGated))
}

export function lufsFromBlockEnergy(energy, channelCount, sampleRate, blockSize, from = 0, to = energy[0]?.length ?? 0) {
  let windowBlocks = Math.ceil(GATE_WINDOW * sampleRate / blockSize)
  let meanSquares = []

  for (let start = from; start < to; start += windowBlocks) {
    let end = Math.min(start + windowBlocks, to)
    let sum = 0
    let count = 0

    for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
      for (let blockIndex = start; blockIndex < end; blockIndex++) {
        sum += energy[channelIndex][blockIndex]
        count++
      }
    }

    if (count > 0) meanSquares.push(sum / count)
  }

  return lufsFromMeanSquares(meanSquares)
}