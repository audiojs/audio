<a name="Audio"></a>

## Audio
**Kind**: global class  

* [Audio](#Audio)
    * [new Audio([input], [options], [noAssert])](#new_Audio_new)
    * [.sampleRate](#Audio+sampleRate) : <code>Number</code>
    * [.bitDepth](#Audio+bitDepth) : <code>Number</code>
    * [.channel](#Audio+channel) : <code>Number</code>
    * [.sampleRate](#Audio+sampleRate) : <code>String</code>
    * [.signed](#Audio+signed) : <code>Boolean</code>
    * [.max](#Audio+max) : <code>Number</code>
    * [.min](#Audio+min) : <code>Number</code>
    * [.length](#Audio+length) : <code>Number</code>
    * [.sample](#Audio+sample) : <code>Buffer</code>
    * [.write(value, [location], [noAssert])](#Audio+write)
    * [.slice(begin, [end], [buf])](#Audio+slice) ⇒ <code>Array</code>

<a name="new_Audio_new"></a>

### new Audio([input], [options], [noAssert])
Digital audio object.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [input] | <code>Array</code> &#124; <code>Buffer</code> |  | Initial sample to write. |
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
<a name="Audio+sampleRate"></a>

### audio.sampleRate : <code>Number</code>
Audio's sample rate

**Kind**: instance property of <code>[Audio](#Audio)</code>  
**Default**: <code>44100</code>  
<a name="Audio+bitDepth"></a>

### audio.bitDepth : <code>Number</code>
Audio's bit-depth

**Kind**: instance property of <code>[Audio](#Audio)</code>  
**Default**: <code>16</code>  
<a name="Audio+channel"></a>

### audio.channel : <code>Number</code>
Audio's number of channels.

**Kind**: instance property of <code>[Audio](#Audio)</code>  
**Default**: <code>2</code>  
<a name="Audio+sampleRate"></a>

### audio.sampleRate : <code>String</code>
Sample data's byte order (either 'LE' or 'BE')

**Kind**: instance property of <code>[Audio](#Audio)</code>  
**Default**: <code>&#x27;LE&#x27;</code>  
<a name="Audio+signed"></a>

### audio.signed : <code>Boolean</code>
Sample data is signed.

**Kind**: instance property of <code>[Audio](#Audio)</code>  
<a name="Audio+max"></a>

### audio.max : <code>Number</code>
Maximum sample pulse value

**Kind**: instance property of <code>[Audio](#Audio)</code>  
<a name="Audio+min"></a>

### audio.min : <code>Number</code>
Minimum sample pulse value

**Kind**: instance property of <code>[Audio](#Audio)</code>  
<a name="Audio+length"></a>

### audio.length : <code>Number</code>
Audio sample's length.

**Kind**: instance property of <code>[Audio](#Audio)</code>  
<a name="Audio+sample"></a>

### audio.sample : <code>Buffer</code>
Audio's sample data

**Kind**: instance property of <code>[Audio](#Audio)</code>  
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

### audio.slice(begin, [end], [buf]) ⇒ <code>Array</code>
Slice pulse values from the sample.

**Kind**: instance method of <code>[Audio](#Audio)</code>  
**Returns**: <code>Array</code> - Array of pulse values or buffer with "buf" param.  

| Param | Type | Description |
| --- | --- | --- |
| begin | <code>Number</code> | Location to start slice. |
| [end] | <code>Number</code> | Ending location for slice. |
| [buf] | <code>Boolean</code> | Keep data as a buffer. |

**Example**  
```js
audio.slice(10, 15);
audio.slice(1000);
audio.slice(37, 65, true);
```
