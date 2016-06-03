<a name="Audio"></a>
## Audio
**Kind**: global class  

* [Audio](#Audio)
    * [new Audio(sample, options)](#new_Audio_new)
    * [.write(value, location, noAssert)](#Audio+write)
    * [.slice(begin, end)](#Audio+slice) ⇒ <code>Array</code>

<a name="new_Audio_new"></a>
### new Audio(sample, options)
Digital audio object.


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| sample | <code>Array</code> &#124; <code>Buffer</code> |  | Audio frequency sample. |
| options | <code>Object</code> |  | Object of options for the audio. |
| options.rate | <code>Number</code> | <code>44100</code> | Sample rate. |
| options.depth | <code>Number</code> | <code>16</code> | Bit depth. |
| options.order | <code>String</code> | <code>&#x27;LE&#x27;</code> | Bit order, either 'BE' or 'LE'. |
| options.length | <code>Number</code> | <code>sample.length</code> | Length of audio. |

<a name="Audio+write"></a>
### audio.write(value, location, noAssert)
Write pulse values to the sample.

**Kind**: instance method of <code>[Audio](#Audio)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| value | <code>Array</code> &#124; <code>Number</code> |  | Number value or array values to write. |
| location | <code>Number</code> | <code>0</code> | Starting point to write value or values. |
| noAssert | <code>Boolean</code> | <code>false</code> | Do not assert on invalid positions. |

<a name="Audio+slice"></a>
### audio.slice(begin, end) ⇒ <code>Array</code>
Slice pulse values from the sample.

**Kind**: instance method of <code>[Audio](#Audio)</code>  
**Returns**: <code>Array</code> - Pulse values  

| Param | Type | Description |
| --- | --- | --- |
| begin | <code>Number</code> | Beginning slice point |
| end | <code>Number</code> | Ending slice point. |

