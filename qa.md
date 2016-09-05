# Q: do we need time-ranges, or tracking selections within audio?

* We can make offset/length or currentTime/duration API, allowing for easy select/edit/play actions. Therefore user may store cache of regions from outside:
```js
{
 sample1: [110, 200],
 sample2: [220, 500]
}
```

# Q: should we track offset/length state with according API, or pass offset in every method where it is reasonable?

+ that simplifies methods API
- .slice is supposed to always take params

# Q: should we use sample units or time?

+ time is more natural, samples are low-level
+ time takes in account current rate and sampleRate, therefore time not simply equal to samples/sampleRate

# Q: shouls we provide chainability or promises?

+ chain is classic and easy
- promise allows for async API
	+ promise returned instead of result breaks sync thing anyways

# Q: mutable or immutable?

+ mutable is nice and natural API
- mutable might be slow for big files
