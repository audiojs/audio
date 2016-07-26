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

  // Byte order: Either "BE" or "LE".
  this.byteOrder = options.byteOrder || 'LE';

  // Block size: Byte depth alignment with channels.
  this.blockSize = options.blockSize || this.channels * this.byteDepth;

  // Block rate: Sample rate alignment with blocks.
  this.blockRate = options.blockRate || this.blockSize * this.sampleRate;

  // Source buffer: The raw PCM data.
  if (options.source) {
    this.source = options.source;
  } else if (!this.source) {
    // new Audio(<length>, [options])
    var len = typeof options === 'number' ? options : options.length;

    // Create from in milliseconds.
    var size = (len || DEFAULT_LENGTH) / 1000 * this.blockRate;
    this.source = new Buffer(size).fill(0);
  }

  // Length: The amount of blocks.
  if (options.length) {
    this.length = options.length;
  } else if (!this.length && this.length !== 0) {
    this.length = Math.ceil(this.source.length / this.blockSize);
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

  // Read sample data.
  read: function read(offset, channel) {
    channel = channel || 1;

    // Align input values to the source.
    offset *= this.blockSize;
    channel--;
    channel *= this.byteDepth;

    // Read value from source.
    return this._read(offset + channel);
  },

  // Write sample data.
  write: function write(value, offset, channel) {
    channel = channel || 1;

    // Align input values to the source.
    offset *= this.blockSize;
    channel--;
    channel *= this.byteDepth;

    // Write value to source.
    return this._write(value, offset + channel);
  },

  // Slice or replicate the object.
  slice: function slice(start, end) {
    start = start || 0;
    end = end === 0 ? 0 : end || this.length;

    // Align start and end to blocs.
    start *= this.blockSize;
    end *= this.blockSize;

    // Replicate self, with a new sliced source.
    return new Audio(this.source.slice(start, end), this);
  }
};

module.exports = Audio;
