/**
 * lil helpers
 */

'use strict'

const callsites = require('callsites')
const extend = require('extend')
const nidx = require('negative-index')
const isBrowser = require('is-browser')
const isRelative = require('is-relative')
const isURL = require('is-url')
const path = require('path')
const pick = require('pick-by-alias')


module.exports = {
	isMultisource,
	parseArgs,
	resolvePath
}


// if source is multisource
function isMultisource(arg) {
	return Array.isArray(arg) &&
		!(typeof arg[0] === 'number' && (arg.length === 1 || typeof arg[1] === 'number')) &&
		!(arg.length < 32 && arg.every(ch => Array.isArray(ch) || ArrayBuffer.isView(ch)))
}


// calc start, end, length and channels params from options
function parseArgs (audio, time, duration, options) {
	// no args at all
	if (time == null && duration == null && options == null) {
		options = {}
		time = 0
		duration = audio.duration
	}
	// single arg
	else if (time != null && duration == null && options == null) {
		// {}
		if (typeof time !== 'number') {
			options = time
			time = 0
			duration = audio.duration
		}
		// number
		else {
			options = {}
			duration = audio.duration
		}
	}
	// two args
	else if (time != null && duration != null && options == null) {
		// 1, 1
		if (typeof duration === 'number') {
			options = {}
		}
		// 1, {}
		else if (typeof duration != 'number') {
			options = duration
			duration = audio.duration
		}
	}

	if (typeof time !== 'number') throw Error('Bad argument `time`')

	if (time == null) time = 0
	if (duration == null) duration = audio.duration

	if (!time && duration < 0) time = -0;

	options = pick(options, {
		channel: 'channel ch numberOfChannel',
		channels: 'channels channelMap',
		destination: 'destination dest dst target out output container',
		start: 'start startTime fromTime',
		end: 'end endTime toTime',
		from: 'from offset fromOffset startOffset',
		to: 'to toOffset endOffset',
		duration: 'duration time',
		length: 'length number',
		format: 'format dtype dataFormat dataType type'
	})

	// ensure channels
	if (options.channel != null) {
		options.channels = options.channel
	}
	if (typeof options.channels === 'number') {
		options.channels = [options.channels]
	}
	if (options.channels == null) {
		let channels = options.channels || audio.channels
		options.channels = []
		for (let i = 0; i < channels; i++) {
			options.channels.push(i)
		}
	}

	if (!Array.isArray(options.channels)) {
		throw Error('Bad `channels` argument')
	}

	// take over from/to params
	// FIXME: reconsider these params
	if (options.from != null) time = options.from
	if (options.to != null) duration = options.to - time
	if (options.length != null) duration = options.length * audio.sampleRate
	if (options.duration != null) duration = options.duration

	// detect raw interval
	if (options.start == null) {
		let startOffset = Math.floor(time * audio.sampleRate)
		startOffset = nidx(startOffset, audio.buffer.length)
		options.start = startOffset
	}
	if (options.end == null) {
		let len = duration * audio.sampleRate
		let endOffset;
		if (len < 0) {
			endOffset = nidx(options.start + len, audio.buffer.length)
		}
		else {
			endOffset = Math.min(options.start + len, audio.buffer.length)
		}
		options.end = endOffset
	}

	// provide full options
	if (options.length == null) options.length = options.end - options.start
	if (options.from == null) options.from = options.start / audio.sampleRate
	if (options.to == null) options.to = options.end / audio.sampleRate
	if (options.duration == null) options.duration = options.length / audio.sampleRate

	return options
}


// path resolver taking in account file structure
function resolvePath (fileName, depth=2) {
	if (!isBrowser && isRelative(fileName) && !isURL(fileName)) {
		var callerPath = callsites()[depth].getFileName()
		fileName = path.dirname(callerPath) + path.sep + fileName
		fileName = path.normalize(fileName)
	}

	return fileName
}
