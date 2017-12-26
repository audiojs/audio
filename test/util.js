'use strict'

let Audio = require('../')
let t = require('tape')

t('offset', t => {
	let a1 = Audio({rate: 22000})

	t.equal(a1.offset(1.2), 22000 * 1.2)


	let a2 = Audio()
	t.equal(a2.offset(-1.2), -44100 * 1.2)

	t.end()
})

t('time', t => {
	let a1 = Audio({rate: 22000})

	t.equal(a1.time(22000), 1)


	let a2 = Audio()
	t.equal(a2.time(-1.2), -1.2 / 44100)

	t.end()
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
