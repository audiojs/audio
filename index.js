/** Digital audio object.
  * @name Audio
  * @param {Array|Buffer} sample - Audio frequency sample.
  * @param {Object} options - Object of options for the audio.
  * @param {Number} options.rate=44100 - Sample rate.
  * @param {Number} options.depth=16 - Bit depth.
  * @param {String} options.order='LE' - Bit order, either 'BE' or 'LE'.
  * @param {Number} options.length=sample.length - Length of audio.
  * @class
  */
function Audio(sample, options) {
  if (!options && sample && sample.constructor === Object) {
    options = sample;
    sample = [];
  }
  options = options || {};
  this.rate = options.rate || 44100;
  this.depth = options.depth || 16;
  this.order = options.order || 'LE';

  if (this.order !== 'LE' && this.order !== 'BE') {
    throw new Error('Order must be "LE" or "BE" (default LE)');
  }

  this._byteDepth = Math.ceil(this.depth / 8);
  this._writing = 'writeInt' + this.order;
  this._reading = 'readInt' + this.order;

  var length = options.length;
  if (typeof length === 'undefined') {
    length = sample.length;
  }
  length *= this._byteDepth;

  if (sample && sample.constructor === Buffer) {
    this.sample = sample;
  } else {
    this.sample = (new Buffer(length)).fill(0);
    this.write(sample);
  }
}

Audio.prototype = {
  constructor: Audio,

  /** Write pulse values to the sample.
    * @name write
    * @param {Array|Number} value - Number value or array values to write.
    * @param {Number} location=0 - Starting point to write value or values.
    * @param {Boolean} noAssert=false - Do not assert on invalid positions.
    * @memberof Audio.prototype
    * @function
    */
  write: function write(value, location, noAssert) {
    if (typeof location === 'undefined') {
      location = 0;
    }
    if (value && value.constructor === Array) {
      for (var i = 0, max = value.length; i < max; i++) {
        this.write(value[i], location + i, noAssert);
      }
      return;
    }
    if (value <= this.depth && value >= -this.depth) {
      var bufloc = location * this._byteDepth;
      this.sample[this._writing](value, bufloc, this._byteDepth, noAssert);
    }
  },

  /** Slice pulse values from the sample.
    * @name slice
    * @param {Number} begin - Beginning slice point
    * @param {Number} end - Ending slice point.
    * @return {Array} Pulse values
    * @memberof Audio.prototype
    * @function
    */
  slice: function slice(begin, end) {
    if (typeof end === 'undefined') {
      end = (this.sample.length - 1) / this._byteDepth;
    }
    var max = end - begin;
    begin *= this._byteDepth;
    end *= this._byteDepth;
    var pulses = [];
    for (var i = 0; i < max; i++) {
      var start = begin + (i * this._byteDepth);
      pulses.push(this.sample[this._reading](start, this._byteDepth));
    }
    return pulses;
  }
};

module.exports = Audio;
