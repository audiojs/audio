// Default values.
var DEFAULT_SAMPLE_RATE = 44100;
var DEFAULT_BIT_DEPTH = 16;
var DEFAULT_CHANNELS = 2;
var DEFAULT_BYTE_ORDER = 'LE';

var Audio = function Audio(options, _replaceSource) {
  options = options || {};

  // Sample rate: PCM sample rate in hertz
  this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;

  // Bit depth: PCM bit-depth.
  this.bitDepth = options.bitDepth || DEFAULT_BIT_DEPTH;

  // Amount of channels: Mono, stereo, etc.
  this.channels = options.channels || DEFAULT_CHANNELS;

  // Byte order: Either "BE" or "LE".
  this.byteOrder = options.byteOrder || DEFAULT_BYTE_ORDER;

  // Byte depth: Bit depth in bytes.
  this._byteDepth = options._byteDepth || Math.ceil(this.bitDepth / 8);

  // Block size: Byte depth alignment with channels.
  this._blockSize = options._blockSize || this.channels * this._byteDepth;

  // Block rate: Sample rate alignment with blocks.
  this._blockRate = options._blockRate || this._blockSize * this.sampleRate;

  // Source: Buffer containing PCM data that is formatted to the options.
  if (options.source || _replaceSource) {
    this.source = _replaceSource || options.source;
  } else {
    var length = this._blockRate * options.duration || 0;
    this.source = new Buffer(length).fill(0);
  }

  // Check that the source is aligned with the block size.
  if (this.source.length % this._blockSize !== 0 && !options.noAssert) {
    throw new RangeError('Source is not aligned to the block size.');
  }

  // Length: The amount of blocks.
  this.length = options.length || this.source.length / this._blockSize;

  // Signed: Whether or not the PCM data is signed.
  if (typeof options.signed === 'undefined') {
    // If bit depth is 8 be unsigned, otherwise be signed.
    this.signed = this.bitDepth !== 8;
  } else {
    this.signed = options.signed;
  }

  // Alias helper functions
  var order = (this._byteDepth * 8) === 8 ? '' : this.byteOrder;
  var sign = this.signed ? '' : 'U';
  var typeTag = sign + 'Int' + (this._byteDepth * 8) + order;
  this._write = this.source['write' + typeTag].bind(this.source);
  this._read = this.source['read' + typeTag].bind(this.source);
};

Audio.prototype = {
  constructor: Audio,

  // Read sample data.
  read: function read(offset, channel) {
    channel = channel || 1;

    // Align inputs to source bytes.
    offset *= this._blockSize;
    channel--;
    channel *= this._byteDepth;

    // Read value from source.
    return this._read(offset + channel);
  },

  // Write sample data.
  write: function write(value, offset, channel) {
    channel = channel || 1;

    // Align inputs to source bytes.
    offset *= this._blockSize;
    channel--;
    channel *= this._byteDepth;

    // Write value to source.
    return this._write(value, offset + channel);
  },

  // Slice or replicate the audio.
  slice: function slice(start, end) {
    start = start || 0;
    end = typeof end === 'number' ? end : this.length;

    // Align start and end to blocs.
    start *= this._blockSize;
    end *= this._blockSize;

    // Replicate self, with a new sliced source.
    var override = this.source.slice(start, end);
    return new Audio(this, override);
  }
};

module.exports = Audio;
