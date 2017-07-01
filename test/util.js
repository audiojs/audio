'use strict'

let Audio = require('../')
let t = require('tape')


t('toArray default', t => {
	let a = Audio(.5)

	let arr = a.toArray()

	t.ok(Array.isArray(arr))
	t.equal(arr.length, 22050)
	t.equal(arr[0], 0)
	t.end()
})

t('toArray uint8 interleaved', t => {
	let a = Audio(.5, 2)

	let arr = a.toArray('uint8 interleaved')

	t.ok(ArrayBuffer.isView(arr))
	t.equal(arr.length, 22050*2)
	t.equal(arr[0], 127)

	t.end()
})
