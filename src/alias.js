'use strict'

let Audio = require('../')

const protoAlias = {
	get: 'read',
	getChannelData: 'read',
	data: 'read',

	fill: 'write',
	set: 'write',

	push: 'insert',
	add: 'insert',
	append: 'insert',
	put: 'insert',
	concat: 'insert',

	delete: 'remove',
	cut: 'remove',
	consume: 'remove',

	process: 'through',

	overlay: 'mix',
	volume: 'gain',

	saveAs: 'save',
	download: 'save',

	copy: 'slice',
	clone: 'slice',
	subaudio: 'slice',

	crop: 'trim',

	rotate: 'shift',

	leftPad: 'pad',
	rightPad: 'pad',

	fadeIn: 'fade',
	fadeOut: 'fade',

	remap: 'channels',
	remix: 'channels',
	mapChannels: 'channels',

	format: 'convert',
	toArray: 'convert',
	toBuffer: 'convert',
	toArrayBuffer: 'covert'
}

for (let alias in protoAlias) {
	let orig = protoAlias[alias]

	Audio.prototype[alias] = () => {
		throw Error('Use `audio.' + orig + '(...)` instead of `audio.' + alias + '(...)`')
	}
}


const classAlias = {
	join: 'from',
	concat: 'from',
	create: 'from',

	equals: 'equal',
	isEqual: 'equal',

	decibel: 'db',
	decibels: 'db',
	toDb: 'db',
	fromGain: 'db',
	toGain: 'gain',
	fromDb: 'gain',

	toOffset: 'offset',
	fromTime: 'offset',
	timeToOffset: 'offset',
	t2o: 'offset',
	o: 'offset',

	toTime: 'time',
	fromOffset: 'time',
	offsetToTime: 'time',
	o2t: 'time',
	t: 'time'
}

for (let alias in classAlias) {
	let orig = classAlias[alias]

	Audio.prototype[alias] = () => {
		throw Error('Use `Audio.' + orig + '(...)` instead of `Audio.' + alias + '(...)`')
	}
}

