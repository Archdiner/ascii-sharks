# How Computers Listen

An interactive, incremental explainer of machine listening: from air pressure to the last layer of a language model, and what each stage loses along the way.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## The course

| # | Chapter | Lesson | You can… |
|---|---------|--------|----------|
| 1 | Capture | Sound is pressure | drive an air-particle field with a tone or your mic |
| 2 | Capture | The microphone | watch MEMS / condenser / dynamic capsules follow your voice |
| 3 | Capture | Sampling | push a tone past Nyquist and hear it alias |
| 4 | Capture | Quantization | crush bit depth, toggle dither, measure SNR |
| 5 | Represent | Frames & FFT | drag a 10–100 ms window across the waveform |
| 6 | Represent | Spectrograms & mel | compare linear / 80-mel / 128-mel, live from the mic |
| 7 | Represent | Where sound gets lost | stack mono, 16 kHz, phase loss, mel, 80 ms pooling, and listen |
| 8 | Encode | The audio encoder | run a Whisper-shaped conv stem + attention on your clip |
| 9 | Encode | From vectors to tokens | train VQ / RVQ codebooks on your clip and hear the decode |
| 10 | Encode | The projector | see the token budget of pool+MLP, Q-Former and codec tokens |
| 11 | Understand | Inside the LM | explore (illustrative) attention across layers |
| 12 | Understand | The LM head | sample with temperature / top-p from text and audio heads |
| 13 | Codecs | Mimi | 12.5 Hz, split RVQ, semantic distillation, bitrate per codebook |
| 14 | Codecs | Moshi | step through full-duplex token streams and the depth transformer |
| 15 | Beyond speech | Sound > speech | measure what a speech front end costs birds, drums, rain, music |
| 16 | Beyond speech | The landscape | map of codecs, tokenizers and audio-LMs, plus open problems |

Every lesson has a live visual, controls, four tabs (**Overview**, **Under the hood**, **What's lost**, **Specs**), and a **Try it yourself** snippet in Python. Its ▶ button runs the same computation in the browser on the current audio.

## What's real

- **Audio:** seven sounds synthesised sample by sample (`src/audio/specimens.ts`), plus live microphone, 4-second recording and file upload.
- **DSP, no libraries** (`src/dsp/`): FFT, STFT/iSTFT, Slaney mel filterbanks, Whisper's log-mel recipe, Griffin-Lim, windowed-sinc resampling, quantisation with dither, k-means, residual VQ, PCA.
- **Not real:** trained neural weights. The encoder uses seeded random kernels and parameter-free attention, the LM attention patterns and head logits are illustrative, and Mimi's tokens come from a toy k-means codec. Each lesson says which parts are which.

## Code map

```
src/main.ts          app shell: layout, routing, progress, console, source bar, keys
src/style.css        palette + components
src/audio/           AudioContext engine, synthesised specimens
src/dsp/             signal processing
src/ui/              DOM / canvas helpers, Python highlighter
src/lessons/         one module per chapter, registered in lessons/index.ts
```

Keys: <kbd>Space</kbd> play/stop · <kbd>R</kbd> run · <kbd>←</kbd> <kbd>→</kbd> lessons.

Visual style after [Learn Arduino](https://learn-arduino-red.vercel.app/) by Dilum Sanjaya.
