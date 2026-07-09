#!/bin/sh
# Publish waves A–C: 59 bumped packages across 11 family repos.
# Run after reviewing family commits. Then in audio:
#   rm the node_modules/@audio symlinks and `npm i` to swap in artifacts.
set -e
H=~/projects/@audio

cd $H/reverb   && for p in schroeder dattorro fdn spring shimmer; do npm publish -w @audio/reverb-$p; done
cd $H/dynamics && for p in fet opto varimu vca multiband; do npm publish -w @audio/dynamics-$p; done
cd $H/filter   && for p in moog-ladder korg35 diode-ladder oberheim resonator spectral-tilt variable comb dcblocker preemphasis; do npm publish -w @audio/filter-$p; done
cd $H/eq       && for p in graphic tilt baxandall dynamic; do npm publish -w @audio/eq-$p; done
cd $H/saturate && for p in tape transistor waveshaper multiband; do npm publish -w @audio/saturate-$p; done
cd $H/amp      && for p in tube cabinet; do npm publish -w @audio/amp-$p; done
cd $H/defeedback && npm publish
cd $H/synth    && for p in noise chirp pluck risset rhythm sfx drum envelope; do npm publish -w @audio/synth-$p; done
cd $H/loudness && for p in truepeak lra replaygain dr; do npm publish -w @audio/loudness-$p; done
cd $H/spectral && for p in rolloff spread slope flux contrast ltas; do npm publish -w @audio/spectral-$p; done
cd $H/mir      && for p in structure tempogram melody downbeat fingerprint drums multif0 transcribe similarity coversong; do npm publish -w @audio/mir-$p; done
echo "published waves A-C (59 packages)"
