import type { Lesson } from "../types";
import { slider, segmented, toggle, button, el } from "../ui/dom";
import { bus } from "../scene/bus";
import { magSpectrum, hann, nextPow2 } from "../dsp/fft";
import { melBank } from "../dsp/mel";
import { derive } from "../pipeline";
import { S, head, unit, screenText, trace, blit, fmtHz, fmtBits, fmtN, specHeat, freqTicks, melFrac, lossyChain, melOnly, type ChainOpts } from "./kit";

// ---------------------------------------------------------------- 5 · frames and the FFT

export const spectrum: Lesson = {
  id: "spectrum",
  short: "Frequencies",
  title: "From wave to frequencies",
  chapter: "Represent",
  thumb: ["fft"],
  focus: ["fft"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "fft.screen", icon: "window", title: "One frame", text: "A slice of the samples, faded at both ends by a window so the cut edges don't add false frequencies.", slot: "tl" },
    { at: "fft.bars", icon: "bars", title: "Spectrum", text: "Each bar is how much of one frequency the slice contains. Low pitches on the left, high on the right.", slot: "bl" },
    { at: "fft.high", icon: "ruler", title: "Resolution", text: "Longer slices separate close pitches better but blur quick events.", slot: "br" },
  ],
  summary: "A list of samples shows how pressure changes over time, but not which pitches are in it. The <b>Fourier transform</b> answers that for one short slice of sound at a time: it measures how strongly each frequency is present. Almost every audio model starts this way.",
  steps: [
    "Cut the samples into short, overlapping <b>frames</b>. Whisper uses 25 ms frames (400 samples at 16 kHz) and starts a new one every 10 ms. That step is called the <b>hop</b>.",
    "Multiply each frame by a <b>window</b>, a smooth bump that fades the frame's edges to zero. A wave cut off abruptly looks like it contains frequencies it doesn't (this is called spectral leakage).",
    "Run the <b>FFT</b> (fast Fourier transform). For each test frequency it measures how closely the frame matches a wave at that frequency. 400 samples give 201 results, spaced 40 Hz apart (16,000 ÷ 400).",
    "Each result has a <b>magnitude</b> (how much of that frequency) and a <b>phase</b> (where in its cycle that wave was when the frame started). The bars show the magnitude.",
    "There's a built-in trade-off. A longer frame separates close pitches better but blurs quick events together. Compare 10 ms and 100 ms on the <i>Drum loop</i>, then on the <i>Piano chord</i>.",
  ],
  lost: `<ul>
    <li><b>Phase, in the next step.</b> Speech front ends keep only the magnitudes. Phase holds the fine timing of the wave: sharp attacks, the exact waveform shape, and timing differences between ears.</li>
    <li><b>Timing inside a frame.</b> Two clicks 5 ms apart fall in the same 25 ms frame and can't be told apart.</li>
  </ul>`,
  words: [
    ["Frame", "A short slice of samples analysed as one unit (Whisper: 25 ms)."],
    ["Hop", "How far the next frame starts after the previous one (Whisper: 10 ms), so frames overlap."],
    ["Window", "A bump-shaped curve multiplied into each frame to fade its edges. Whisper uses the Hann window."],
    ["Fourier transform", "Splits a signal into the frequencies it's made of."],
    ["FFT", "Fast Fourier transform: an efficient way to compute it on a computer."],
    ["Frequency bin", "One of the frequencies the FFT reports, spaced sample rate ÷ frame length apart."],
    ["Magnitude", "How much of a frequency is present."],
    ["Phase", "Where in its cycle a frequency's wave is at the start of the frame."],
  ],
  specs: [
    ["Whisper frame", "400 samples = 25 ms"],
    ["Whisper hop", "160 samples = 10 ms → 100 frames/s"],
    ["FFT size", "400 → 201 bins, 40 Hz apart"],
    ["Window", "Hann"],
    ["Frames in 30 s", "3,000"],
  ],
  code: `import numpy as np

sr, win, hop = 16000, 400, 160               # 25 ms frames, 10 ms hop
w = np.hanning(win + 1)[:-1]                  # periodic Hann window

frames = np.stack([x[i:i + win] * w for i in range(0, len(x) - win, hop)])
spec = np.abs(np.fft.rfft(frames, n=win))     # (frames, 201) magnitudes

freqs = np.fft.rfftfreq(win, 1 / sr)          # 0, 40, 80, ... 8000 Hz
print(spec.shape, "strongest:", freqs[spec.mean(0).argmax()], "Hz")`,
  rate: (p) => { const d = derive(p); return { value: fmtBits(d.melFps * (d.winSamples / 2 + 1) * 32), note: `${d.melFps} frames/s × ${Math.floor(d.winSamples / 2) + 1} values` }; },
  mount(ctx) {
    const { audio } = ctx;
    let pos = 0.35, shape: "hann" | "rect" = "hann";
    ctx.row("cut", "<b>Frame length.</b> The window size Whisper uses is 25 ms. This setting carries forward to the mel bands and the encoder.",
      segmented("Frame", [["10", "10 ms"], ["25", "25 ms"], ["50", "50 ms"], ["100", "100 ms"]], String(ctx.pipe().winMs), (v) => ctx.setPipe({ winMs: Number(v) })));
    ctx.row("window", "<b>Window shape.</b> Compare the bars with and without fading the edges. Without it, energy smears across every frequency.",
      segmented("Window", [["hann", "Hann"], ["rect", "None"]], shape, (v) => (shape = v as "hann" | "rect")));
    const posS = slider({ label: "Position", min: 0, max: 1, step: 0.001, value: pos, fmt: (v) => `${(v * (audio.clip.channels[0].length / audio.clip.sr)).toFixed(2)} s`, onInput: (v) => (pos = v) });
    ctx.row("target", "<b>Where in the sound.</b> Drag to move the frame, or press play and it follows the sound.", posS);
    const sRes = ctx.stat("Frequency step"), sT = ctx.stat("Time span"), sBins = ctx.stat("Bins"), sPk = ctx.stat("Strongest");
    let spec: Float32Array = new Float32Array(1), frame: Float32Array = new Float32Array(1), win: Float32Array = new Float32Array(1), start = 0;
    const compute = () => {
      const a = ctx.analysis(), sr = ctx.pipe().sr, x = a.x;
      const p = audio.position();
      if (p >= 0 && audio.playing === "clip") { pos = Math.min(1, p / audio.duration); posS.set(pos); }
      const n = derive(ctx.pipe()).winSamples;
      start = Math.max(0, Math.min(x.length - n, Math.floor(pos * x.length - n / 2)));
      frame = x.slice(start, start + n);
      win = shape === "hann" ? hann(n) : new Float32Array(n).fill(1);
      const nFft = n <= 512 ? n : nextPow2(n);
      spec = magSpectrum(frame, nextPow2(nFft), win);
      // hand the 3D bars this frame's spectrum in dB
      let mx = 1e-9; for (const v of spec) mx = Math.max(mx, v);
      bus.hold = spec.map((v) => 20 * Math.log10(Math.max(v / mx, 1e-6)) - 10);
      bus.holdSr = sr;
      let pk = 1; for (let k = 2; k < spec.length; k++) if (spec[k] > spec[pk]) pk = k;
      sRes.set(`${(sr / n).toFixed(1)} Hz`);
      sT.set(`${ctx.pipe().winMs} ms`);
      sBins.set(fmtN(Math.floor(n / 2) + 1));
      sPk.set(fmtHz((pk * sr) / ((spec.length - 1) * 2)));
    };
    const tick = ctx.world.onTick(compute);
    ctx.screen("fft", (g, w, h) => {
      const u = unit(h);
      const a = ctx.analysis(), x = a.x;
      head(g, w, h, `Frame of ${ctx.pipe().winMs} ms`, `${(start / ctx.pipe().sr).toFixed(2)} s`);
      // whole sound with the frame marked
      trace(g, x, 4 * u, 14 * u, w - 8 * u, 18 * u, "#6c7a9e", 0.4 * u, 1.5);
      const fx = 4 * u + (start / x.length) * (w - 8 * u), fw = Math.max(0.8 * u, (frame.length / x.length) * (w - 8 * u));
      g.fillStyle = "#1aa3a155"; g.fillRect(fx, 14 * u, fw, 18 * u);
      // the frame and its window
      trace(g, frame, 4 * u, 34 * u, w * 0.4, 30 * u, "#6c7a9e", 0.5 * u, 1.4);
      trace(g, frame.map((v, i) => v * win[i]), 4 * u, 34 * u, w * 0.4, 30 * u, S.teal, 0.7 * u, 1.4);
      screenText(g, "× window", 4 * u, 70 * u, 4.6 * u, S.teal);
      // spectrum on a log-frequency axis
      const sx = w * 0.46, sw = w - sx - 4 * u, sy = 34 * u, sh = 52 * u, nyq = ctx.pipe().sr / 2;
      let mx = 1e-9; for (const v of spec) mx = Math.max(mx, v);
      g.beginPath();
      for (let k = 1; k < spec.length; k++) {
        const hz = (k / (spec.length - 1)) * nyq;
        const px = sx + (Math.log(hz / 30) / Math.log(nyq / 30)) * sw;
        const d = Math.max(-70, 20 * Math.log10(spec[k] / mx + 1e-9));
        const py = sy + sh * (-d / 70);
        k > 1 ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.strokeStyle = S.orange; g.lineWidth = 0.6 * u; g.stroke();
      for (const t of [100, 1000, 4000]) if (t < nyq) screenText(g, t >= 1000 ? `${t / 1000}k` : `${t}`, sx + (Math.log(t / 30) / Math.log(nyq / 30)) * sw, sy + sh + 6 * u, 4.4 * u, S.dim, "center", true);
      screenText(g, "Hz →", sx + sw, sy + sh + 6 * u, 4.4 * u, S.dim, "right");
    });
    return () => { tick(); bus.hold = null; };
  },
  run(ctx) {
    const a = ctx.analysis(), p = ctx.pipe(), d = derive(p);
    ctx.log(`${fmtN(a.x.length)} samples at ${p.sr} Hz, frames of ${d.winSamples} every ${d.hopSamples}`);
    ctx.log(`→ ${fmtN(a.mel.frames.length)} frames × ${Math.floor(d.winSamples / 2) + 1} frequencies, ${(p.sr / d.winSamples).toFixed(1)} Hz apart`);
    for (const ms of [10, 25, 100]) ctx.log(`  ${String(ms).padStart(3)} ms frame: frequency step ${(1000 / ms).toFixed(0).padStart(3)} Hz, events closer than ${ms} ms blur together`, "dim");
    ctx.log("Short frames: sharp in time, blurry in pitch. Long frames: the reverse.", "ok");
  },
};

// ---------------------------------------------------------------- 6 · mel bands

const MELS = [20, 40, 80, 128];

export const mel: Lesson = {
  id: "mel",
  short: "Mel spectrogram",
  title: "The spectrogram and the mel scale",
  chapter: "Represent",
  thumb: ["mel"],
  focus: ["mel"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "mel.paper", icon: "sheet", title: "Spectrogram", text: "Time runs down the paper, pitch from left (low) to right (high). Darker means louder. Press play to watch it print.", slot: "tr" },
    { at: "mel.knob", icon: "knob", title: "Band dial", text: "How many mel bands to print. Click it to turn.", slot: "br" },
    { at: "mel.screen", icon: "filter", title: "Filterbank", text: "Each triangle adds up the energy near one pitch. Low ones are narrow, high ones wide.", slot: "tl" },
  ],
  summary: "Put the spectrum of every frame side by side and you get a <b>spectrogram</b>, a picture of the sound. Speech models then shrink it the way hearing works: they merge the frequencies into about 80 <b>mel bands</b>, narrow for low pitches and wide for high ones, and take the logarithm of the loudness. The result is the input to Whisper and most speech models.",
  steps: [
    "Lay the spectra side by side: time across, frequency up, loudness as colour. That's a spectrogram.",
    "People hear pitch roughly logarithmically: 100 → 200 Hz sounds like the same step as 1,000 → 2,000 Hz. The <b>mel scale</b> copies this. It's close to even below 1 kHz and logarithmic above.",
    "A <b>mel filterbank</b> is a row of overlapping triangles spaced evenly on the mel scale. Each one adds up the energy of the FFT bins under it, giving one number per band.",
    "Take log10 of each band, because hearing compresses loudness the same way: ten times the energy sounds about twice as loud.",
    "Whisper's exact recipe: 80 bands from 0 to 8 kHz, log10, keep only the top 80 dB, then rescale to roughly −1 to 1. Whisper large-v3 uses 128 bands. At 100 frames a second that's 8,000 numbers per second.",
  ],
  lost: `<ul>
    <li><b>Phase is gone completely.</b> Only the energy in each band is kept. Press <b>Hear only the bands</b> to listen to a reconstruction: the words survive, the clarity doesn't.</li>
    <li><b>Fine pitch in the upper range.</b> With 80 bands at 16 kHz, a band near 4 kHz spans several hundred hertz, several semitones. Two notes that close merge into one number.</li>
    <li><b>Quiet detail.</b> Anything more than 80 dB below the loudest moment is raised to that floor.</li>
    <li><b>Everything above half the sample rate</b>, lost earlier at the ADC.</li>
  </ul>`,
  words: [
    ["Spectrogram", "A picture of sound: time across, frequency up, loudness as colour."],
    ["Mel scale", "A pitch scale spaced the way people hear: even steps sound like even changes in pitch."],
    ["Filterbank", "A set of filters, each passing one range of frequencies."],
    ["Mel band", "One filter's output: the total energy in one range of pitches."],
    ["Log-mel spectrogram", "Mel bands with the logarithm of their energy. The standard input to speech models."],
    ["Semitone", "One step on a piano keyboard, a frequency ratio of about 1.06."],
  ],
  specs: [
    ["Whisper bands", "80 (v1–v2) · 128 (large-v3)"],
    ["Range", "0 – 8 kHz (Slaney mel)"],
    ["Frames", "100 per second, 3,000 per 30 s"],
    ["Numbers per second", "8,000 (80 bands)"],
    ["Loudness kept", "top 80 dB"],
  ],
  code: `import torch, torchaudio

wav, sr = torchaudio.load("clip.wav")
wav = torchaudio.functional.resample(wav.mean(0), sr, 16000)

spec = torch.stft(wav, n_fft=400, hop_length=160, window=torch.hann_window(400),
                  return_complex=True)
power = spec.abs()[..., :-1] ** 2                  # phase is dropped here
fb = torchaudio.functional.melscale_fbanks(201, 0, 8000, 80, 16000,
                                           norm="slaney", mel_scale="slaney")
logmel = (fb.T @ power).clamp(min=1e-10).log10()
logmel = torch.maximum(logmel, logmel.max() - 8.0)  # keep the top 80 dB
logmel = (logmel + 4.0) / 4.0
print(logmel.shape)                                 # (80, frames)`,
  rate: (p) => { const d = derive(p); return { value: fmtBits(d.melBps), note: `${p.nMels} bands × ${d.melFps}/s × 32 bit` }; },
  mount(ctx) {
    const { audio } = ctx;
    const nm = () => ctx.pipe().nMels;
    const mS = slider({ label: "Bands", min: 16, max: 128, step: 8, value: nm(), onInput: (v) => ctx.setPipe({ nMels: v }) });
    ctx.click("mel", (part) => { if (part !== "knob") return; const next = MELS.find((m) => m > nm()) ?? MELS[0]; ctx.setPipe({ nMels: next }); mS.set(next); }, (part) => (part === "knob" ? "Click to change the number of bands" : part === "paper" ? "The printed spectrogram of the current sound" : null));
    ctx.row("knob", "<b>Number of bands.</b> Turn the dial on the printer, or drag. Fewer bands means a blurrier picture with fewer numbers.", mS);
    ctx.row("play", "<b>Watch it print.</b> Press play in the bar below: the paper prints the sound as it plays.");
    ctx.row("ear", "<b>Hear only the bands.</b> Rebuild sound from the band energies alone, at the current settings. Then try 16 bands.",
      el("div", { class: "btns" }, button("▶ Hear only the bands", () => {
        const a = ctx.analysis();
        ctx.log("Rebuilding from band energies (guessing the missing phase)…", "dim");
        setTimeout(() => audio.playSignal([melOnly(a.x, a.pipe.sr, a.pipe.nMels, a.clip.id)], a.pipe.sr), 30);
      }, "btn primary"), button("▶ Original", () => audio.playClip(), "btn")));
    const sB = ctx.stat("Bands"), sN = ctx.stat("Numbers / second"), sLo = ctx.stat("Width at 250 Hz"), sHi = ctx.stat("Width at 4 kHz");
    const width = (hz: number) => {
      const p = ctx.pipe(), bank = melBank(p.sr, 512, p.nMels, 0, p.sr / 2);
      let m = 0;
      for (let j = 0; j < p.nMels; j++) if (Math.abs(bank.edges[j + 1] - hz) < Math.abs(bank.edges[m + 1] - hz)) m = j;
      return (bank.edges[m + 2] - bank.edges[m]) / 2;
    };
    const update = () => {
      const p = ctx.pipe();
      sB.set(String(p.nMels));
      sN.set(fmtN(p.nMels * derive(p).melFps));
      sLo.set(`${Math.round(width(250))} Hz`);
      sHi.set(p.sr / 2 > 4000 ? `${Math.round(width(4000))} Hz` : "above range");
    };
    update();
    const tick = ctx.world.onTick(update);
    ctx.screen("mel", (g, w, h) => {
      const u = unit(h), p = ctx.pipe(), nyq = p.sr / 2;
      head(g, w, h, `${p.nMels} mel filters`, `0 – ${fmtHz(nyq)}`);
      const bank = melBank(p.sr, 512, p.nMels, 0, nyq);
      const x0 = 4 * u, ww = w - 8 * u, base = 74 * u, top = 20 * u;
      const X = (hz: number) => x0 + (hz / nyq) * ww;
      const every = p.nMels > 64 ? 2 : 1;
      for (let m = 0; m < p.nMels; m += every) {
        g.beginPath(); g.moveTo(X(bank.edges[m]), base); g.lineTo(X(bank.edges[m + 1]), top); g.lineTo(X(bank.edges[m + 2]), base);
        g.strokeStyle = (m / every) % 2 ? S.teal : S.orange; g.lineWidth = 0.4 * u; g.stroke();
      }
      g.strokeStyle = S.ink; g.lineWidth = 0.4 * u; g.beginPath(); g.moveTo(x0, base); g.lineTo(x0 + ww, base); g.stroke();
      for (let hz = 0; hz <= nyq; hz += nyq > 12000 ? 4000 : 2000) screenText(g, hz ? `${hz / 1000}k` : "0", X(hz), base + 7 * u, 4.4 * u, S.dim, "center", true);
      screenText(g, "narrow", X(nyq * 0.04), 92 * u, 4.8 * u, S.ink, "left");
      screenText(g, "wide", X(nyq * 0.92), 92 * u, 4.8 * u, S.ink, "right");
    });
    return () => tick();
  },
  run(ctx) {
    const a = ctx.analysis(), p = ctx.pipe();
    const fr = a.mel.frames;
    let mn = Infinity, mx = -Infinity;
    for (const f of fr) for (const v of f) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
    ctx.log(`log-mel of "${a.clip.name}": ${p.nMels} bands × ${fmtN(fr.length)} frames = ${fmtN(fr.length * p.nMels)} numbers`);
    ctx.log(`values from ${mn.toFixed(2)} to ${mx.toFixed(2)} (Whisper's scale; the floor is max − 2.0, i.e. 80 dB)`);
    const energy = new Float32Array(p.nMels);
    for (const f of fr) for (let m = 0; m < p.nMels; m++) energy[m] += f[m];
    const bank = melBank(p.sr, 512, p.nMels, 0, p.sr / 2);
    const top = [...energy.keys()].sort((x, y) => energy[y] - energy[x]).slice(0, 3);
    ctx.log(`loudest bands: ${top.map((m) => `#${m} around ${fmtHz(bank.edges[m + 1])}`).join(", ")}`);
    ctx.log("This grid of numbers is everything a Whisper-style encoder receives.", "ok");
  },
};

// ---------------------------------------------------------------- 7 · what the front end throws away

const STEPS: { key: keyof ChainOpts; name: string; why: string }[] = [
  { key: "mono", name: "Stereo → mono", why: "Average the left and right channels. Anything that differed between them (where a sound came from) cancels or merges." },
  { key: "sr16", name: "48 → 16 kHz", why: "Resample for the model. Everything above 8 kHz is removed." },
  { key: "phase", name: "Drop phase", why: "Keep only how much of each frequency there is, not where each wave was in its cycle." },
  { key: "mel", name: "80 mel bands", why: "Merge frequencies into 80 bands spaced like hearing." },
  { key: "pool", name: "80 ms steps", why: "Average over 80 ms, the frame length of Mimi (lesson 13). Fast events smear." },
];

export const lost: Lesson = {
  id: "lost",
  short: "What's thrown away",
  title: "What the front end throws away",
  chapter: "Represent",
  thumb: ["adc", "fft", "mel"],
  focus: ["mic", "adc", "fft", "mel"],
  view: { fill: 0.82, offset: [0, 0.03] },
  callouts: [
    { at: "mic.grille", icon: "stereo", title: "Stereo → mono", text: "Two ears become one channel.", slot: "tl" },
    { at: "adc.clock", icon: "clock", title: "48 → 16 kHz", text: "Everything above 8 kHz is removed.", slot: "bl" },
    { at: "fft.bars", icon: "bars", title: "Phase dropped", text: "How much of each frequency survives, but not the wave's exact shape.", slot: "br" },
    { at: "mel.screen", icon: "screen", title: "Before and after", text: "Top: the sound as recorded. Bottom: what's left. Hatching means nothing there.", slot: "tr" },
  ],
  summary: "Each choice so far is reasonable on its own. Stacked up, they remove a lot. This lesson applies the real steps of a speech front end to the current sound, then turns the result back into audio so you can hear what a speech model is left with.",
  steps: [
    "Pick a sound and switch on one step at a time, pressing <b>Hear what's kept</b> after each.",
    "<i>Ping-pong</i> with only <b>Stereo → mono</b>: the left-right motion disappears.",
    "<i>Birdsong</i> with <b>48 → 16 kHz</b>: half the song is gone. The monitor shows the empty band above 8 kHz.",
    "Any sound with <b>Drop phase</b>: a metallic, smeared quality appears. The missing phase has to be guessed (here with the Griffin-Lim algorithm) and the guess is imperfect.",
    "<i>Drum loop</i> with <b>80 ms steps</b>: the attacks go soft.",
    "<i>Vowels</i> with everything on: still recognisable. Speech survives these steps, which is why speech models use them.",
  ],
  lost: `<ul>
    <li><b>Mono:</b> direction, width, and the room's left/right reflections.</li>
    <li><b>16 kHz:</b> sibilance (s, sh), breath, cymbals, birds, and the brightness of a recording.</li>
    <li><b>Phase:</b> the sharpness of attacks and the exact waveform.</li>
    <li><b>Mel bands:</b> fine pitch above about 1 kHz, close musical intervals, harmonic detail.</li>
    <li><b>80 ms steps:</b> rhythm detail, fast trills, the gap between two quick clicks.</li>
  </ul>
  <p>What's left is roughly what was said, how loud, and the overall shape of the voice. That's what transcription needs.</p>`,
  words: [
    ["Front end", "The fixed processing before the neural network: resampling, framing, FFT, mel bands."],
    ["Mono", "One audio channel. Stereo has two, left and right."],
    ["Griffin-Lim", "An algorithm that guesses missing phase by repeatedly converting between waveform and spectrum."],
    ["Vocoder", "Anything that turns a spectrogram-like representation back into audio. Neural vocoders guess better than Griffin-Lim, but they're still guessing."],
  ],
  specs: [
    ["Rebuild method", "Griffin-Lim, 16–28 rounds"],
    ["STFT at 48 / 16 kHz", "2048 / 512 points, ¼ hop"],
    ["Mel step", "80 bands to Nyquist, then spread back"],
    ["80 ms steps", "average of the log energies"],
  ],
  code: `import numpy as np, librosa, soundfile as sf

y, sr = librosa.load("clip.wav", sr=None, mono=False)
y = librosa.to_mono(y)                                   # 1. mono
y = librosa.resample(y, orig_sr=sr, target_sr=16000)     # 2. 16 kHz
S = np.abs(librosa.stft(y, n_fft=512, hop_length=128))   # 3. no phase
M = librosa.feature.melspectrogram(S=S ** 2, sr=16000, n_mels=80)   # 4.

# hear what's left: spread the bands back out, then guess the phase
S_hat = librosa.feature.inverse.mel_to_stft(M, sr=16000, n_fft=512)
y_hat = librosa.griffinlim(S_hat, hop_length=128)
sf.write("what_the_model_keeps.wav", y_hat, 16000)`,
  rate: () => ({ value: "2.30 M → 256 k", note: "bits per second, in → out" }),
  mount(ctx) {
    const { audio } = ctx;
    const o: ChainOpts = { mono: true, sr16: true, phase: false, mel: false, pool: false };
    let before: HTMLCanvasElement | null = null, after: HTMLCanvasElement | null = null, key = "", busy = false;
    let result: { channels: Float32Array[]; sr: number } | null = null;
    for (const s of STEPS) ctx.row(s.key === "mono" ? "stereo" : s.key === "sr16" ? "clock" : s.key === "phase" ? "wave" : s.key === "mel" ? "filter" : "cut", `<b>${s.name}.</b> ${s.why}`, toggle(s.name, o[s.key], (v) => { o[s.key] = v; status.text("Switches changed. Press <b>Hear what's kept</b> to rebuild."); }));
    const status = ctx.row("ear", "Press to apply the switched-on steps to the current sound and listen.",
      el("div", { class: "btns" }, button("▶ Hear what's kept", () => void apply(true), "btn primary"), button("▶ Original", () => audio.playClip(), "btn")));
    const sCh = ctx.stat("Channels"), sBw = ctx.stat("Highest pitch"), sPh = ctx.stat("Phase");
    const k = () => `${audio.clip.id}|${STEPS.map((s) => +o[s.key]).join("")}`;
    async function apply(play: boolean) {
      if (busy) return;
      if (k() !== key || !result) {
        busy = true;
        status.text("Rebuilding…");
        await new Promise((r) => setTimeout(r, 30));
        const t0 = performance.now();
        result = lossyChain(audio.clip, o);
        after = specHeat(result.channels[0], result.sr, 24000, 200);
        key = k();
        busy = false;
        status.text(`Rebuilt in ${((performance.now() - t0) / 1000).toFixed(1)} s. Playing what a speech model keeps.`);
      }
      sCh.set(o.mono ? "1 (was " + (audio.clip.channels[0] === audio.clip.channels[1] ? "1)" : "2)") : "unchanged");
      sBw.set(o.sr16 ? "8 kHz" : fmtHz(audio.clip.sr / 2));
      sPh.set(o.phase || o.mel || o.pool ? "guessed" : "kept");
      if (play && result) audio.playSignal(result.channels, result.sr);
    }
    const refresh = () => { before = specHeat(audio.clip.channels[0], audio.clip.sr, 24000, 200); void apply(false); };
    refresh();
    ctx.onChange(() => { if (!key.startsWith(audio.clip.id)) refresh(); });
    ctx.screen("mel", (g, w, h) => {
      const u = unit(h);
      head(g, w, h, "Recorded  /  kept", o.sr16 ? "cut at 8 kHz" : "");
      const x0 = 12 * u, ww = w - 15 * u, hh = 37 * u;
      for (const [im, y, lab] of [[before, 14 * u, "recorded"], [after, 57 * u, "kept"]] as const) {
        if (im) blit(g, im, x0, y, ww, hh);
        freqTicks(g, x0, y, hh, 24000, u);
        screenText(g, lab, x0 + 2 * u, y + 5 * u, 4.6 * u, S.ink);
        const p = audio.position();
        if (p >= 0 && audio.playing) { g.fillStyle = S.orange; g.fillRect(x0 + (p / audio.duration) * ww, y, 0.5 * u, hh); }
      }
      if (o.sr16) { const yy = 57 * u + hh - melFrac(8000, 24000) * hh; g.strokeStyle = S.red; g.setLineDash([1.2 * u, 1 * u]); g.lineWidth = 0.4 * u; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + ww, yy); g.stroke(); g.setLineDash([]); }
    });
    return undefined;
  },
  async run(ctx) {
    const c = ctx.audio.clip;
    const L = c.channels[0], R = c.channels[1];
    let mid = 0, side = 0;
    for (let i = 0; i < L.length; i++) { mid += ((L[i] + R[i]) / 2) ** 2; side += ((L[i] - R[i]) / 2) ** 2; }
    ctx.log(`"${c.name}"`);
    ctx.log(`energy only in the left/right difference: ${((100 * side) / (mid + side || 1)).toFixed(1)} %  → lost by mono`, side > mid * 0.05 ? "warn" : "info");
    const x = new Float32Array(L.length); for (let i = 0; i < L.length; i++) x[i] = (L[i] + R[i]) / 2;
    const n = 2048, win = hann(n), acc = new Float32Array(n / 2 + 1);
    for (let i = 0; i + n <= x.length; i += n / 2) { const m = magSpectrum(x.subarray(i, i + n), n, win); for (let k = 0; k < m.length; k++) acc[k] += m[k] * m[k]; }
    let tot = 0, above = 0;
    const cut = Math.floor((8000 / (c.sr / 2)) * (n / 2));
    acc.forEach((v, k) => { tot += v; if (k >= cut) above += v; });
    ctx.log(`energy above 8 kHz: ${((100 * above) / (tot || 1)).toFixed(1)} %  → lost at 16 kHz`, above > tot * 0.05 ? "warn" : "info");
    ctx.log(`bits per second: ${fmtBits(c.sr * 24 * 2)} as recorded → ${fmtBits(16000 * 16)} at 16 kHz → ${fmtBits(80 * 100 * 32)} as log-mel floats`);
    ctx.log("Same order of bits as the 16 kHz audio, but a blurrier description of the sound.", "ok");
  },
};
