<a name="Audio"></a>
## Audio
**Kind**: global class  

* [Audio](#Audio)
    * [new Audio([sample], [options], [noAssert])](#new_Audio_new)
    * [.write(value, [location], [noAssert])](#Audio+write)
    * [.slice(being, [end], [buf])](#Audio+slice) ⇒ <code>Array</code>

<a name="new_Audio_new"></a>
### new Audio([sample], [options], [noAssert])
Digital audio object.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [sample] | <code>Array</code> &#124; <code>Buffer</code> |  | Initial sample to write. |
| [options] | <code>Object</code> |  | Options for your audio. |
| [options.sampleRate] | <code>Number</code> | <code>44100</code> | Audio sample rate. |
| [options.bitDepth] | <code>Number</code> | <code>16</code> | Audio bit depth. |
| [options.channels] | <code>Number</code> | <code>2</code> | Number of channels. |
| [options.length] | <code>Number</code> |  | Length of audio buffer in bytes. |
| [options.max] | <code>Number</code> |  | Maximum pulse value. |
| [options.min] | <code>Number</code> |  | Minimum pulse value. |
| [options.byteOrder] | <code>String</code> | <code>&#x27;LE&#x27;</code> | Audio byte order ('LE' or 'BE'). |
| [options.signed] | <code>Boolean</code> |  | Sample data is signed. |
| [noAssert] | <code>Boolean</code> | <code>false</code> | Avoid initial write's assertion. |

**Example**  
```js
new Audio(sample, {...options});
new Audio({...options});
new Audio(sample);
```
<a name="Audio+write"></a>
### audio.write(value, [location], [noAssert])
Write pulse values to the sample.

**Kind**: instance method of <code>[Audio](#Audio)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| value | <code>Array</code> &#124; <code>Buffer</code> |  | Array of pulses or a buffer of PCM data. |
| [location] | <code>Number</code> | <code>0</code> | Offset to write data. |
| [noAssert] | <code>Boolean</code> | <code>false</code> | Skip writing assertions. |

**Example**  
```js
audio.write([1, 2, 100, -45]);
audio.write(new Buffer(...data), 50);
```
<a name="Audio+slice"></a>
### audio.slice(being, [end], [buf]) ⇒ <code>Array</code>
Slice pulse values from the sample.

**Kind**: instance method of <code>[Audio](#Audio)</code>  
**Returns**: <code>Array</code> - Array of pulse values or buffer with "buf" param.  

| Param | Type | Description |
| --- | --- | --- |
| being | <code>Number</code> | Location to start slice. |
| [end] | <code>Number</code> | Ending location for slice. |
| [buf] | <code>Boolean</code> | Keep data as a buffer. |

**Example**  
```js
audio.slice(10, 15);
audio.slice(1000);
audio.slice(37, 65, true);
```
