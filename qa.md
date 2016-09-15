# Q: do we need time-ranges, or tracking selections within audio?

* We can make offset/length or currentTime/duration API, allowing for easy select/edit/play actions. Therefore user may store cache of regions from outside:
```js
{
 sample1: [110, 200],
 sample2: [220, 500]
}
```
- seems that anyways we need to pass offsets to slice, therefore no

# Q: should we track offset/length state with according API, or pass offset in every method where it is reasonable?

+ that simplifies methods API
- .slice is supposed to always take params
- stateless behaviour is more explicit and better I guess
✘ no, pass to every method

# Q: should we use sample units or time?

+ time is more natural, samples are low-level
+ time takes in account current rate and sampleRate, therefore time not simply equal to samples/sampleRate
+ if we resample or change rate, time is still valid. If we used sample units, we would have to change offsets.
✔ time

# Q: shouls we provide chainability or promises?

+ chain is classic and easy
- promise allows for async API
	+ promise returned instead of result breaks sync thing anyways
✘ no

# Q: immutable or mutable?

+ immutable is nice and natural API
- immutable might be slow for big files
+ immutable allows for easy history states
	- though with mutable we can implement that manually more precisely
✔ mutable

# Q: should we store bars?

- no, wavearea does that quite specifically, there is not much yet, only gl-waveform and wavearea
