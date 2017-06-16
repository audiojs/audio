const Audio = require('../')
const t = require('tape')
const AudioBuffer = require('audio-buffer')
const db = require('decibels')
const lena = require('audio-lena')
const isBrowser = require('is-browser')
const path = require('path')
const fs = require('fs')
const AudioBufferList = require('audio-buffer-list')
const util = require('audio-buffer-utils')


t('decode base64')

t('decode File mp3')
t('decode File flac')
t('decode File alac m4c')
t('decode File alac the other one')
t('decode File aac')
t('decode File wav')

t('decode Blob')
