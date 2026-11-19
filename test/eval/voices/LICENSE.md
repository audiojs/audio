# The eval's voices

Five recordings, each the source's own 16-bit samples, cut as below and stored losslessly as FLAC (decoded, every
sample equals the source's: `node test/eval/voices/cut.js` makes them again from the datasets and checks it). Nothing
else is changed. Both sources are under the Creative Commons Attribution 4.0 International licence
(https://creativecommons.org/licenses/by/4.0/); these files are under it too.

## VoiceBank+DEMAND

Valentini-Botinhao, C. (2017). Noisy speech database for training speech enhancement algorithms and TTS models.
University of Edinburgh, School of Informatics, Centre for Speech Technology Research (CSTR).
https://doi.org/10.7488/ds/2117. CC BY 4.0.

From `clean_testset_wav/`, whole (speakers p232 and p257, 48 kHz, mono):

| file | source | samples |
|---|---|---|
| p232_013.flac | clean_testset_wav/p232_013.wav | 0 to 189283, all (3.943 s) |
| p257_014.flac | clean_testset_wav/p257_014.wav | 0 to 177237, all (3.692 s) |
| p232_052.flac | clean_testset_wav/p232_052.wav | 0 to 105549, all (2.199 s) |
| p257_087.flac | clean_testset_wav/p257_087.wav | 0 to 123135, all (2.565 s) |

## VocalSet

Wilkins, J., Seetharaman, P., Wahl, A., Pardo, B. (2018). VocalSet: A Singing Voice Dataset. Proceedings of the 19th
ISMIR Conference. https://zenodo.org/records/1193957. CC BY 4.0.

| file | source | samples |
|---|---|---|
| f2_caro_vibrato.flac | FULL/female2/excerpts/vibrato/f2_caro_vibrato.wav | 0 to 198449 of 1636232: its first 4.5 s, cut (44.1 kHz, mono) |
