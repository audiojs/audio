//possible use-cases for audiojs


//Basic processing: trim, normalize, fade, save
Audio('./sample.mp3').trim().normalize().fadeIn(.3).fadeOut(1).download();
//- obvious load event is ignored, expected sync API is actually a sort of hidden mechanism. better stick to `.on` method, make it close to Image class, make it sync



//Record 4s of mic input
navigator.getUserMedia({audio: true}, stream =>	Audio(stream, {duration: 4}).download());
//- unobvious when downloading will actually happen.
//By fact what there happens is audio.on('end', audio => audio.download());


//Record, process and download web-audio experiment
let ctx = new AudioContext();
let osc = ctx.createOscillator();
osc.type = 'sawtooth';
osc.frequency.value = 440;
osc.start();
osc.connect(ctx.destination);
let audio = Audio(osc);
setTimeout(() => {
	osc.stop();
	audio.end().download();
}, 2000);
//so there is just basically a writing mode - whether from mic or stream, or xml http request (which is also a stream by fact), and after it ends - viola, you can download the thing


//Download AudioBuffer returned from offlineContext
let offlineCtx = new OfflineAudioContext(2,44100*40,44100);
osc.connect(offlineCtx);
offlineCtx.startRendering().then((audioBuffer) => {
	Audio(audioBuffer).download();
});
//offlineCtx interface is pretty much similar to audio btw, we wait for data to load and then we handle it


//Montage audio
let audio = Audio('./record.mp3');
audio.set(Audio(audio.get(2.1, 1)).scale(.9), 3.1); //repeat slowed down fragment
audio.delete(2.4, 2.6).fadeOut(.3, 2.1); //delete fragment, fade out
audio.splice(2.4, Audio('./other-record.mp3')); //insert other fragment not overwriting the existing data
//unclear when the set method is going to start and what that actually it, to vague. Better call write or read.
//and also handle data only when loaded.
//also wtf is splice, why is it here, it is not an array. Call it merge or mix.
audio.load(res).then(audio => {
	audio.write(Audio(audio.read(2.1, 1)).scale(.9), 3.1)
	audio.delete(...)
});
