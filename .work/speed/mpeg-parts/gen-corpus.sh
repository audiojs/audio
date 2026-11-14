#!/bin/sh
# gen-corpus.sh <bench-600s.wav> <dir>: the long WAV and MPEG files the differential tests ran on (ffmpeg, lame, sox)
W=$1; C=$2; mkdir -p $C && cd $C
f() { ffmpeg -y -hide_banner -loglevel error -i $W -t ${T:-75} "$@"; }
f -c:a pcm_s16le w16.wav; f -c:a pcm_s24le w24.wav; f -c:a pcm_s32le w32.wav; f -c:a pcm_f32le wf32.wav; f -c:a pcm_f64le wf64.wav; f -c:a pcm_u8 w8.wav
f -c:a pcm_alaw walaw.wav; f -c:a pcm_mulaw wulaw.wav; f -ac 1 -c:a pcm_s16le wmono.wav; f -ar 96000 -c:a pcm_s24le w96k.wav
T=40 f -af "pan=5.1|c0=c0|c1=c1|c2=c0|c3=c1|c4=c0|c5=c1" -c:a pcm_s16le w51.wav
f -c:a pcm_s16le -write_bext 1 wbext.wav; f -c:a pcm_s16le -metadata title=Long -metadata artist=Someone wlist.wav
f -c:a adpcm_ima_wav wima.wav; f -c:a adpcm_ms wms.wav; f -c:a pcm_s24le -rf64 always wrf64.wav
T=80.123 f -c:a pcm_s16le wodd.wav; f -ac 2 -c:a pcm_s16le -f wav pipe:1 > wstream.wav
f -b:a 192k m192.mp3; f -b:a 32k m32.mp3; f -b:a 320k m320.mp3; f -q:a 0 mvbr0.mp3; f -q:a 9 mvbr9.mp3; f -abr 1 -b:a 128k mabr.mp3
f -ac 1 -b:a 96k mmono.mp3; f -ar 48000 -b:a 160k m48.mp3; f -ar 32000 -b:a 96k m32k.mp3; f -b:a 128k -write_xing 0 mnoxing.mp3
f -ar 22050 -b:a 64k mlsf.mp3; f -c:a mp2 -b:a 224k ml2.mp2; f -joint_stereo 0 -b:a 128k mlr.mp3
f -b:a 128k -id3v2_version 3 -metadata title=T -metadata artist=A mid3.mp3; f -b:a 128k -write_id3v1 1 -metadata title=T mid3v1.mp3
sox $W -t wav - trim 0 75 | lame --quiet -b 128 -p - mcrc.mp3; sox $W -t wav - trim 0 75 | lame --quiet -V 4 - mlame.mp3
sox $W -t wav - trim 0 75 | lame --quiet -b 128 -t - mnotag.mp3; sox $W -t wav - trim 0 75 remix 1 1 | lame --quiet -m s -b 160 - mdualsame.mp3
sox $W -t wav - trim 0 75 | lame --quiet --freeformat -b 400 - mfree.mp3
head -c 1000000 m192.mp3 > mtrunc.mp3; cp m192.mp3 mjunk.mp3; printf 'JUNKJUNKJUNK' >> mjunk.mp3; cp m192.mp3 mtag.mp3; printf 'APETAGEX' >> mtag.mp3
python3 -c "b = open('m192.mp3','rb').read(); i = len(b)//2; open('mmid.mp3','wb').write(b[:i] + b'\x00'*37 + b[i:])"
# lengths for the crossover: 30 to 240 s, MP3 192 kbps and 16-bit WAV
for T in 30 50 75 100 150 240; do ffmpeg -y -hide_banner -loglevel error -i $W -t $T -b:a 192k m$T.mp3; ffmpeg -y -hide_banner -loglevel error -i $W -t $T -c:a pcm_s16le w$T.wav; done
