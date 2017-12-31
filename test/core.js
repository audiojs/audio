'use strict'

let Audio = require('../')
let t = require('tape')
let AudioBuffer = require('audio-buffer')


// TODO: test if is online/offline


t('audio.offset', t => {
	let a1 = Audio({rate: 22000})

	t.equal(a1.offset(1.2), 22000 * 1.2)


	let a2 = Audio()
	t.equal(a2.offset(-1.2), -44100 * 1.2)

	t.end()
})

t('audio.time', t => {
	let a1 = Audio({rate: 22000})

	t.equal(a1.time(22000), 1)


	let a2 = Audio()
	t.equal(a2.time(-1.2), -1.2 / 44100)

	t.end()
})

t.skip('Audio.isAudio', t => {
	// let a1 = Audio(1000)

	// t.ok(Audio.isAudio(a1))

	// t.notOk(Audio.isAudio())
	// t.notOk(Audio.isAudio(new AudioBuffer({length: 1024})))

	// t.end()
})

t('Audio.equal', t => {
	let a1 = Audio({length: 1000})
	let a2 = Audio({length: 1000})
	let a3 = Audio({length: 1001})
	let a4 = Audio({length: 1000}).fill(1)
	let a5 = Audio.from(Audio({length: 500}).fill(1), Audio({length: 500}).fill(1))

	t.ok(Audio.equal(a1, a2))
	t.notOk(Audio.equal(a2, a3))
	t.notOk(Audio.equal(a2, a4))
	t.ok(Audio.equal(a4, a5))
	t.ok(Audio.equal(a1, Audio({length: 1000}), a2))
	t.notOk(Audio.equal(a1, Audio({length: 1000}), a3))

	t.end()
})

t.skip('audio.serialize', t => {

})

t.skip('toArray default', t => {
	let a = Audio(.5)

	let arr = a.toArray()

	t.ok(Array.isArray(arr))
	t.equal(arr.length, 22050)
	t.equal(arr[0], 0)
	t.end()
})

t.skip('toArray uint8 interleaved', t => {
	let a = Audio(.5, 2)

	let arr = a.toArray('uint8 interleaved')

	t.ok(ArrayBuffer.isView(arr))
	t.equal(arr.length, 22050*2)
	t.equal(arr[0], 127)

	t.end()
})
