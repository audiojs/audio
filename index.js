// Default values.
var DEFAULT_SAMPLE_RATE = 44100;
var DEFAULT_BIT_DEPTH = 16;
var DEFAULT_CHANNELS = 2;
var DEFAULT_LENGTH = 10000;

var Audio = function Audio(options) {
  // Sample rate: PCM sample rate in hertz
  this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;

  // Bit depth: PCM bit-depth.
  this.bitDepth = options.bitDepth || DEFAULT_BIT_DEPTH;

  // Amount of channels: Mono, stereo, etc.
  this.channels = options.channels || DEFAULT_CHANNELS;

  // Byte depth: Bit depth in bytes.
  this.byteDepth = Math.ceil(this.bitDepth / 8);

  // Block size: Byte depth alignment with channels.
  this.blockSize = this.channels * this.blockChannelSize;

  // Byte rate: Sample rate alignment with blocks.
  this.byteRate = this.blockSize * this.sampleRate;

  // Source buffer: The raw PCM data.
  if (options.source) {
    this.source = options.source;
  } else {
    var size = (options.length || DEFAULT_LENGTH) * this.byteRate;
    this.source = new Buffer(size).fill(0);
  }
};

Audio.prototype = {
  constructor: Audio
};

module.exports = Audio;
