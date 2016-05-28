/** Digital audio object.
  * @name Audio
  * @param {Array} sample - Audio frequency sample.
  * @param {Object} options - Object of options for the audio.
  * @class
  */
function Audio(sample, options) {
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

  this.sample = Buffer.alloc(length);
  this.write(sample);
}

Audio.prototype = {
  constructor: Audio,

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
    if (value > this.depth || value < -this.depth) {
      return;
    }
    var bufloc = location * this._byteDepth;
    this.sample[this._writing](value, bufloc, this._byteDepth, noAssert);
  },

  read: function read(location, noAssert) {
    var bufloc = location * this._byteDepth;
    return this.sample[this._reading](bufloc, this._byteDepth, noAssert);
  }
};

module.exports = Audio;
