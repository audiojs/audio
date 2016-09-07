/** @module  audio-source/src/browser-play play buffer in browser via WAA */

'use strict';

module.exports = function (buffer, how) {
	let context = how.context;
	let sourceNode = context.createBufferSource();
	sourceNode.buffer = buffer;
	source.connect(context.destination);

	//FIXME: init options here
	source.start();
}
