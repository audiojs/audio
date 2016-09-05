/**
 * @module  audio
 *
 * High-level audio container
 */
'use strict';

const AudioBuffer = require('audio-buffer');
const Emitter = require('events').EventEmitter;
const inherits = require('inherits');
const xhr = require('xhr');
const xhrProgress = require('xhr-progress');
const extend = require('just-extend');
const decode = require('audio-decode');
const isBrowser = require('is-browser');
const util = require('audio-buffer-utils');


module.exports = Audio;


//for events sake
inherits(Audio, Emitter);


//@contructor
function Audio(source, options) {
	options = options || {};

	extend(this, options);

	//load source from url
	if (typeof source === 'string') {
		this.load(source);
	}
	else if (source instanceof ArrayBuffer) {
		this.decode(source);
	}
	else {
		//create audio buffer from any source data
		this.buffer = util.create(source);
	}




	// // Sample rate: PCM sample rate in hertz
	// this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;

	// // Bit depth: PCM bit-depth.
	// this.bitDepth = options.bitDepth || DEFAULT_BIT_DEPTH;

	// // Amount of channels: Mono, stereo, etc.
	// this.channels = options.channels || DEFAULT_CHANNELS;

	// // Byte order: Either "BE" or "LE".
	// this.byteOrder = options.byteOrder || DEFAULT_BYTE_ORDER;

	// // Byte depth: Bit depth in bytes.
	// this._byteDepth = options._byteDepth || Math.ceil(this.bitDepth / 8);

	// // Block size: Byte depth alignment with channels.
	// this._blockSize = options._blockSize || this.channels * this._byteDepth;

	// // Block rate: Sample rate alignment with blocks.
	// this._blockRate = options._blockRate || this._blockSize * this.sampleRate;

	// Source: Buffer containing PCM data that is formatted to the options.
	// if (options.source || _replaceSource) {
	//   this.source = _replaceSource || options.source;
	// } else {
	//   var length = this._blockRate * options.duration || 0;
	//   this.source = new Buffer(length).fill(0);
	// }

	// Check that the source is aligned with the block size.
	// if (this.source.length % this._blockSize !== 0 && !options.noAssert) {
	//   throw new RangeError('Source is not aligned to the block size.');
	// }
}



//regulate volume of playback/output/read etc
Audio.prototype.volume = 1;

//regulate rate of playback/output/read etc
Audio.prototype.rate = 1;


//load file by url
Audio.prototype.load = function load (src, cb) {
	//TODO: add audio-element mode
	//can load file in node
	if (!isBrowser && /\\\/\./.test(src[0])) {
		fs.readFile();
	}

	let xhrObject = xhr({
			uri: src,
			responseType: 'arraybuffer'
		},
		(err, resp, arrayBuf) => {
			if (!/^2/.test(resp.statusCode)) {
				err = new Error('Status code ' + resp.statusCode + ' requesting ' + src)
			}
			if (err) {
				cb && cb(err);
				this.emit('error', err);
				throw err;
			}
			decode(arrayBuf, {context: this.context}, (err, buf) => {
				if (err) {
					cb && cb(err);
					return this.emit('error', err);
				}

				this.buffer = buf;

				cb && cb(null, buf);
				this.emit('load', buf);
			});
		});

	xhrProgress(xhrObject).on('data', (amount, total) => {
		this.emit('progress', amount, total);
	});

	return this;
}


//return slice of data as audio buffer
Audio.prototype.read = function () {

}

//put a slice of data as audio buffer
Audio.prototype.write = function (data) {

}


//preview the sound
Audio.prototype.play = function play () {

}


//pause playback
Audio.prototype.pause = function pause () {

}


//utilities
Audio.prototype.reverse = function reverse () {

}
Audio.prototype.size = function size () {

}
Audio.prototype.mix = function mix () {

}
Audio.prototype.trim = function trim () {

}
Audio.prototype.normalize = function normalize () {

}
Audio.prototype.shift = function shift () {

}
Audio.prototype.pad = function pad () {

}
Audio.prototype.concat = function concat () {

}
Audio.prototype.slice = function slice () {

}
Audio.prototype.invert = function invert () {

}
Audio.prototype.copy = function copy () {

}
Audio.prototype.isEqual = function isEqual () {

}
