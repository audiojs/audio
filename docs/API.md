## `new Audio(options)`
An object containing a PCM source, with audio settings alongside it, and methods for simplified reading and writing.  This is object purposely designed minimal.  Use/create [utilities][npm-audiojs] for wrapping more complex functionality with the reading and writing.
```javascript
var audio = new Audio({ ...options });
```

### Options
All are optional, some may be important if you are passing in a `source`.
- `source` (`Buffer`): A PCM-formatted buffer.
- `duration` (`Number`): A length (in seconds) to initialize an empty `source` buffer. (Default `0`)
- `sampleRate` (`Number`): The PCM sample rate in hertz. (Default `44100`)
- `bitDepth` (`Number`): The PCM bit depth. (Default `16`)
- `channels` (`Number`): The amount of channels. (Default `2`)
- `byteOrder` (`String`): Either `'LE'` or `'BE'`. (Default `'LE'`)
- `noAssert` (`Boolean`): Skip `source` checks. (Default `false`)
- `signed` (`Boolean`): Whether the `source` blocks are signed or not. (Defaults to `true` if `bitDepth` is more than `8`)

All together, the defaults specify 16-bit stereo 44100 Hz audio.

### `.read(offset, [channel])`
Read a pulse value at `offset` on the specified `channel`.
- `offset` (`Number`): The offset of the block to read at.
- `channel` (`Number`): The channel to read. (i.e. `1` or `2` for stereo)

```javascript
var test = [
  // Reading at block 2.
  audio.read(2, 1), // First channel
  audio.read(2, 2)  // Second channel
];
```

### `.write(value, offset, [channel])`
Write a pulse value  at `offset` on the specified `channel`.
- `value` (`Number`): The pulse value to write.
- `offset` (`Number`): The offset of the block to read at.
- `channel` (`Number`): The channel to read. (i.e. `1` or `2` for stereo)
- Returns the position wrote at on `.source`.

```javascript
// Write at block 4
audio.write(3, 4, 1); // 3 on first channel.
audio.write(4, 4, 2); // 4 on second channel.
```

### `.slice(start, [end])`
Slice the audio from `start` to `end`.
- `start` (`Number`): Starting block index.
- `end` (`Number`): Ending block index.
- Returns a new `Audio`.

```javascript
var output = audio.slice(6, 100);
var val = output.read(1, 1);
```

### `.source`
Buffer containing PCM data that is formatted to the other properties.
```javascript
var speaker = new Speaker({ ...options });
speaker.write(audio.source);
```
(Example using [`node-speaker`][node-speaker])

### `.sampleRate`
PCM sample rate on the `source` in hertz.  Used for time-related operations like playback or the `duration` option.
```javascript
audio.sampleRate === 44100;
```

### `.bitDepth`
PCM bit depth on the `source`.  Specifies the maximum and minimum pulse value thresholds.
```javascript
audio.bitDepth === 16;
```

### `.channels`
The amount of channels the `source` has.
```javascript
audio.channels === 2;
```

### `.byteOrder`
Whether the `source` is Big Endian (`'BE'`) or Little Endian (`'LE'`).
```javascript
audio.byteOrder === 'LE';
```

### `.length`
The `source`'s length in blocks.
```javascript
audio.length === 120;
```

### `.signed`
Whether the `source` values are signed or unsigned.
```javascript
audio.signed === true;
```

## Extras
- `_byteDepth`: Bit-depth turned into ceil rounded bytes. (`ceil (bitDepth / 8)`)
- `_blockSize`: The size of a block (pulses of each channel) in bytes. (`channels * _byteDepth`)
- `_blockRate`: Amount of blocks per second, for simulating time. (i.e. used with duration, or in playback)
- `_read`: A Buffer read function adjusted to `_blockSize`.  [i.e. `Buffer#read<signed>Int<_blockSize>(...)`
- `_write`: Just like `_read` but with `Buffer#write`.

Refer to this [_Stereo source_][stereo-source] flowchart for help with terminology.

[npm-audiojs]: https://www.npmjs.com/browse/keyword/audiojs
[node-speaker]: https://github.com/tootallnate/node-speaker
[stereo-source]: flowcharts/stereo-source.svg
