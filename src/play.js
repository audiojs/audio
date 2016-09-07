/** @module  audio-source/src/play, play audio buffer in node */

'use strict';

const AudioSource = require('audio-source');
const AudioSpeaker = require('audio-speaker');

module.exports = function (buffer, how) {
	let read = AudioSource(buffer, how);
	let write = AudioSpeaker(how);

	(function loop (err, buf) {
		if (err) return;
		//TODO: add play/pause control here
		buf = read(buf);
		write(buf, loop);
	})();
}
