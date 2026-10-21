# How Computers Listen

An interactive, incremental explainer of machine listening: from air pressure to the last layer of a language model, and what each stage loses along the way.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FArchdiner%2Fascii-sharks&project-name=how-computers-listen&repository-name=how-computers-listen)

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Deploy

Click **Deploy with Vercel** above, or import this repo at [vercel.com/new](https://vercel.com/new). `vercel.json` sets the Vite build, output to `dist/`, and a `Permissions-Policy` header that allows the microphone. Vercel serves HTTPS, which browsers require for mic access.

## The course

The page is an illustrated 3D machine with eleven stations: speaker → microphone → ADC → spectrum analyser → mel printer → encoder → token tray → projector → language model → output, plus a speaker for the model's voice. Each lesson flies the camera to its station, labels the parts with callouts, and puts that station's monitor in an inspector panel so you can see exactly what each setting changes.

| # | Chapter | Lesson | You can |
|---|---------|--------|---------|
| – | Start | How a computer hears you | record yourself and watch the sound travel through every station |
| 1 | Capture | Sound is moving air | change pitch, loudness and wave shape; see wavelength and pressure |
| 2 | Capture | The microphone | switch capsule types; set preamp gain and hear hiss vs clipping |
| 3 | Capture | Sampling | click the crystal clock to change the rate; push a tone past Nyquist and hear it alias |
| 4 | Capture | Bit depth | drop bits, toggle dither, read the measured SNR |
| 5 | Represent | From wave to frequencies | move a 10–100 ms window through the sound; the 3D bars show its spectrum |
| 6 | Represent | Spectrogram and mel scale | turn the band dial, watch the printer print, hear only the band energies |
| 7 | Represent | What the front end throws away | switch on mono / 16 kHz / no phase / 80 bands / 80 ms and hear the result |
| 8 | Encode | The encoder | Whisper-shaped convolutions and attention on your sound; plates show each layer |
| 9 | Encode | Tokens | residual codebooks on the tray; hear 1–8 codebooks; codebooks trained on speech only |
| 10 | Encode | The projector | pooling factor vs tokens per second and context budget |
| 11 | Understand | Attention | pick a token, change sharpness and the causal mask, see what it reads from |
| 12 | Understand | The LM head | temperature / top-p over label scores, or generate new audio tokens and listen |
| 13 | Models that talk | Mimi | Kyutai's 12.5 Hz split-RVQ codec, bitrate per codebook |
| 14 | Models that talk | Moshi | step through full-duplex token streams; compare with a cascade |
| 15 | Beyond speech | What speech pipelines miss | per-sound costs: bandwidth, stereo, timing, pitch, speech-trained codebooks |
| 16 | Beyond speech | Where the field is | map of codecs and tokenizers, the models that use them, open problems |
| 17 | Beyond speech | Your voice, end to end | presets, a stage-by-stage table for your recording, and listening at each stage |

Settings changed in one lesson (sample rate, bit depth, frame length, mel bands, stride, pooling) carry forward to every later station and to the end-to-end view.

Each lesson has four tabs (**Overview** with the controls, **How it works**, **What's lost**, **Words & specs**) and a **Try it yourself** snippet in Python whose ▶ button runs the same computation in the browser on the current sound.

## What's real

- **Audio:** seven sounds synthesised sample by sample, your microphone, 4-second recordings and uploaded files.
- **Signal processing** (`src/dsp/`), written from scratch: FFT plus an exact 400-point DFT, STFT with reflect padding, Slaney mel filterbanks, Whisper's log-mel recipe step for step, Griffin-Lim, windowed-sinc resampling, quantisation with dither, k-means, residual VQ.
- **Model parts** run on your sound with untrained (seeded) weights: Whisper-shaped convolutions, attention, an 8-codebook toy codec at Mimi's 80 ms frame rate, a label head and a next-token model over codec tokens. Each lesson says what is real and what is simplified. Mimi and Moshi themselves need their trained weights; their lessons show how to run them.

## Code map

```
src/main.ts         app shell: layout, lessons, callouts, inspector, view bar, flow animation
src/scene/          three.js world, toon materials and outlines, the stations, monitors
src/analysis.ts     the current sound run through the pipeline settings (mel, encoder, codes, labels)
src/pipeline.ts     shared pipeline settings and presets
src/audio/          Web Audio engine and synthesised sounds
src/dsp/            signal processing
src/lessons/        one file per chapter; kit.ts holds monitor drawing helpers
```

Keys: <kbd>Space</kbd> play · <kbd>R</kbd> run · <kbd>←</kbd> <kbd>→</kbd> lessons · <kbd>Q</kbd> <kbd>E</kbd> turn · <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>0</kbd> reset view. Drag to pan.

Visual style after [Learn Arduino](https://learn-arduino-red.vercel.app/) by Dilum Sanjaya.
