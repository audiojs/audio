var assign = require('object-assign');

/** Digital audio object.
  * @class
  * @name Audio
  * @param {Array|Buffer} [input] - Initial sample to write.
  * @param {Object} [options] - Options for your audio.
  * @param {Number} [options.sampleRate=44100] - Audio sample rate.
  * @param {Number} [options.bitDepth=16] - Audio bit depth.
  * @param {Number} [options.channels=2] - Number of channels.
  * @param {Number} [options.length] - Length of audio buffer in bytes.
  * @param {Number} [options.max] - Maximum pulse value.
  * @param {Number} [options.min] - Minimum pulse value.
  * @param {String} [options.byteOrder='LE'] - Audio byte order ('LE' or 'BE').
  * @param {Boolean} [options.signed] - Sample data is signed.
  * @param {Boolean} [noAssert=false] - Avoid initial write's assertion.
  * @example
  * new Audio(sample, {...options});
  * new Audio({...options});
  * new Audio(sample);
  */
function Audio(input, options, noAssert) {
  if (input && input.constructor === Object) {
    options = input;
    input = [];
  } else if (typeof input === 'undefined') {
    input = [];
  }

  if (options && typeof options.sample !== 'undefined') {
    input = options.sample;
  }

  // Assign options to object, fill in defaults.
  assign(this, {
    /** Audio's sample rate
      * @type {Number}
      * @memberof Audio
      * @instance
      * @name sampleRate
      * @default 44100
      */
    sampleRate: 44100,

    /** Audio's bit-depth
      * @type {Number}
      * @memberof Audio
      * @instance
      * @name bitDepth
      * @default 16
      */
    bitDepth: 16,

    /** Audio's number of channels.
      * @type {Number}
      * @memberof Audio
      * @instance
      * @name channel
      * @default 2
      */
    channels: 2,

    /** Sample data's byte order (either 'LE' or 'BE')
      * @type {String}
      * @memberof Audio
      * @instance
      * @name sampleRate
      * @default 'LE'
      */
    byteOrder: 'LE'
  }, options);

  /** Sample data is signed.
    * @type {Boolean}
    * @memberof Audio
    * @instance
    * @name signed
    */
  if (typeof this.signed === 'undefined') {
    this.signed = this.bitDepth <= 8;
  }

  // Check that byteOrder is valid.
  if (this.byteOrder !== 'LE' && this.byteOrder !== 'BE') {
    throw new TypeError('Order must be "LE" or "BE" (default "LE")');
  }

  /** Maximum sample pulse value
    * @type {Number}
    * @memberof Audio
    * @instance
    * @name max
    */
  if (typeof this.max === 'undefined') {
    this.max = Math.pow(2, this.bitDepth - this.signed) - 1;
  }

  /** Minimum sample pulse value
    * @type {Number}
    * @memberof Audio
    * @instance
    * @name min
    */
  if (typeof this.min === 'undefined') {
    this.min = this.signed ? -Math.pow(2, this.bitDepth - 1) : 0;
  }

  // Sample byte sizing
  this._byteSize = Math.ceil(this.bitDepth / 8);

  /** Audio sample's length.
    * @type {Number}
    * @memberof Audio
    * @instance
    * @name length
    */
  if (typeof this.length === 'undefined') {
    if (input.constructor === Buffer) {
      this.length = input.length;
    } else if (input.constructor === Array) {
      this.length = input.length * this._byteSize;
    } else {
      throw new Error('Could not determine sample buffer size.');
    }
  }

  /** Audio's sample data
    * @type {Buffer}
    * @memberof Audio
    * @instance
    * @name sample
    */
  this.sample = new Buffer(this.length).fill(0);

  // Setup buffer reading and writing with info.
  var typing = (this.signed ? '' : 'U') + 'Int' + this.byteOrder;
  this._write = this.sample['write' + typing].bind(this.sample);
  this._read = this.sample['read' + typing].bind(this.sample);

  // Write initial sample
  if (input && input.constructor === Buffer) {
    this.sample = input;
  } else {
    this.write(input, 0, noAssert || this.noAssert);
  }
}

Audio.prototype = {
  // For reference and type checking.
  constructor: Audio,

  /** Write pulse values to the sample.
    * @method
    * @memberof Audio#
    * @name write
    * @param {Array|Buffer|Number} value - Pulse number or array of pulses or a buffer of PCM data.
    * @param {Number} [location=0] - Offset to write data.
    * @param {Boolean} [noAssert=false] - Skip writing assertions.
    * @example
    * audio.write([1, 2, 100, -45]);
    * audio.write(new Buffer(...data), 50);
    */
  write: function write(value, location, noAssert) {
    // Default location.
    if (typeof location === 'undefined') {
      location = 0;
    }

    if (value && value.constructor === Array) {
      // Write array of pulse values.
      for (var i = 0, max = value.length; i < max; i++) {
        var val = value[i];
        var bufloc = this._byteSize * (location + i);
        if (val < this.min || val > this.max) {
          if (!noAssert) {
            var range = this.min + ' through ' + this.max;
            throw new RangeError('Value ' + val + ' not in range ' + range);
          }
          val = val <= this.min ? this.min : this.max;
        }
        this._write(val, bufloc, this._byteSize, noAssert);
      }
      return;
    } else if (typeof value === 'number') {
      this._write(value, this._byteSize * location, this._byteSize, noAssert);
      return;
    } else if (value && value.constructor === Buffer) {
      // Write buffer
      location *= this._byteSize;
      value.copy(this.sample, location);
      return;
    }

    if (!noAssert) {
      // Error if no writing happened.
      throw new TypeError('Value must be an array or buffer.');
    }
  },

  /** Slice pulse values from the sample.
    * @method
    * @memberof Audio#
    * @name slice
    * @param {Number} begin - Location to start slice.
    * @param {Number} [end] - Ending location for slice.
    * @param {Boolean} [buf] - Keep data as a buffer.
    * @return {Array} Array of pulse values or buffer with "buf" param.
    * @example
    * audio.slice(10, 15);
    * audio.slice(1000);
    * audio.slice(37, 65, true);
    */
  slice: function slice(begin, end, buf) {
    if (typeof end === 'undefined') {
      end = Math.ceil(this.sample.length / this._byteSize);
    }
    // Simple buffer slicing
    if (buf) {
      return this.sample.slice(begin * this._byteSize, end * this._byteSize);
    }

    var pulses = [];
    for (var i = 0, max = end - begin; i < max; i++) {
      var pulse = this._read(this._byteSize * (begin + i), this._byteSize);
      pulses.push(pulse);
    }

    return pulses;
  }
};

module.exports = Audio;
