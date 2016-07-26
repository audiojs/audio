// Default values.
var DEFAULT_SAMPLE_RATE = 44100;
var DEFAULT_BIT_DEPTH = 16;
var DEFAULT_CHANNELS = 2;
var DEFAULT_LENGTH = 10000;

var Audio = function Audio(options, _) {
  if (options instanceof Buffer) {
    // new Audio(<source>, [options])
    this.source = options;
    options = _ || {};
  } else if (!options) {
    // new Audio()
    options = {};
  }

  // Sample rate: PCM sample rate in hertz
  this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;

  // Bit depth: PCM bit-depth.
  this.bitDepth = options.bitDepth || DEFAULT_BIT_DEPTH;

  // Amount of channels: Mono, stereo, etc.
  this.channels = options.channels || DEFAULT_CHANNELS;

  // Byte depth: Bit depth in bytes.
  this.byteDepth = options.byteDepth || Math.ceil(this.bitDepth / 8);

  // Block size: Byte depth alignment with channels.
  this.blockSize = options.blockSize || this.channels * this.byteDepth;

  // Byte rate: Sample rate alignment with blocks.
  this.byteRate = options.byteRate || this.blockSize * this.sampleRate;

  // Byte order: Either "BE" or "LE".
  this.byteOrder = options.byteOrder || 'LE';

  // Source buffer: The raw PCM data.
  if (!this.source) {
    if (options.source) {
      this.source = options.source;
    } else {
      var size = (options.length || DEFAULT_LENGTH) / 1000 * this.byteRate;
      this.source = new Buffer(size).fill(0);
    }
  }

  // Length: Size of the audio in milliseconds (rounded).
  if (!this.length) {
    if (options.length) {
      this.length = options.length;
    } else {
      var len = Math.ceil(this.source.length / Math.ceil(this.byteRate / 1000));
      this.length = len;
    }
  }

  // Signed: Whether or not the PCM data is signed.
  if (options.signed) {
    this.signed = options.signed;
  } else {
    // If bit depth is 8 be unsigned, otherwise be signed.
    this.signed = this.bitDepth !== 8;
  }

  // Alias helper functions
  var order = (this.byteDepth * 8) === 8 ? '' : this.byteOrder;
  var typeTag = (this.signed ? '' : 'U') + 'Int' + (this.byteDepth * 8) + order;
  this._write = this.source['write' + typeTag].bind(this.source);
  this._read = this.source['read' + typeTag].bind(this.source);
};

Audio.prototype = {
  constructor: Audio,

  // Read pulse data.
  read: function read(offset, channel) {
    channel = channel || 1;

    // Align offset to blocks.
    offset *= this.blockSize;

    // shift starting index from 1 to 0, then align channels to byte depth.
    channel--;
    channel *= this.byteDepth;

    // Read value from source.
    return this._read(offset + channel);
  },

  // Write pulse data.
  write: function write(value, offset, channel) {
    channel = channel || 1;

    // Align offset to blocks.
    offset *= this.blockSize;

    // shift starting index from 1 to 0, then align channels to byte depth.
    channel--;
    channel *= this.byteDepth;

    // Write value to source.
    return this._write(value, offset + channel);
  }
};

module.exports = Audio;
