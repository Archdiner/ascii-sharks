import type { Lesson } from "../types";
import { slider, segmented, toggle, button, el } from "../ui/dom";
import { bus } from "../scene/bus";
import { monoAt } from "../analysis";
import { resample, quantize, rms, db, normalize } from "../dsp/signal";
import { rng, gaussian } from "../dsp/rand";
import { S, head, unit, screenText, trace, fmtHz, fmtBits, fmtN } from "./kit";

const C = 343; // speed of sound in air at 20 °C, m/s

// ---------------------------------------------------------------- 1 · sound

type Shape = "sine" | "sawtooth" | "square";
const SHAPES: Record<Shape, (p: number) => number> = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  sawtooth: (p) => { let s = 0; for (let k = 1; k <= 24; k++) s += ((k % 2 ? 1 : -1) * Math.sin(2 * Math.PI * k * p)) / k; return s * 0.55; },
  square: (p) => { let s = 0; for (let k = 1; k <= 25; k += 2) s += Math.sin(2 * Math.PI * k * p) / k; return s * 1.05; },
};

export const sound: Lesson = {
  id: "sound",
  short: "Moving air",
  title: "Sound is moving air",
  chapter: "Capture",
  thumb: ["source"],
  focus: ["source", "mic"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "source.cone", icon: "speaker", title: "Speaker cone", text: "Moves forward and back, squeezing and stretching the air in front of it.", slot: "tl" },
    { at: "source.air", icon: "rings", title: "Sound waves", text: "Bands of squeezed air moving outward at 343 metres per second.", slot: "tc" },
    { at: "source.screen", icon: "wave", title: "Pressure over time", text: "Up means squeezed, down means stretched. One up-and-down is one period.", slot: "tr" },
  ],
  summary: "Sound is a pattern of tiny pressure changes travelling through the air. A vibrating object squeezes the air next to it, that air squeezes the next, and the pattern spreads out. Everything later in this course is about measuring and describing that pattern.",
  steps: [
    "The speaker cone moves forward. The air directly in front of it gets squeezed: its pressure rises slightly.",
    "The cone moves back. That air stretches out: its pressure drops slightly below normal.",
    "Each patch of air pushes on the next, so the pattern travels outward at about <b>343 metres per second</b>. The air itself only jiggles back and forth in place.",
    "Repeat this 440 times a second and you hear the note A. The distance between two squeezes is the <b>wavelength</b>: 343 ÷ 440 = 0.78 m.",
    "Real sounds mix many frequencies at once. A voice has a lowest frequency (its pitch, around 85–255 Hz for adults) plus many higher ones called <b>harmonics</b>, which give it its character.",
  ],
  lost: `
    <p>Nothing has been lost yet. The air carries the whole sound: every frequency, arriving from every direction, plus echoes off every wall in the room.</p>
    <ul><li><b>Next, direction goes.</b> A microphone measures pressure at a single point. Where a sound came from survives only as tiny timing differences between two or more microphones.</li></ul>`,
  words: [
    ["Pressure", "How hard the air pushes on a surface. Sound is a small, fast change in it."],
    ["Frequency", "How many times per second the pressure goes up and down. You hear it as pitch."],
    ["Hertz (Hz)", "The unit of frequency. 1 Hz is once per second; 1 kHz is 1,000 times per second."],
    ["Amplitude", "How big the pressure change is. You hear it as loudness."],
    ["Decibel (dB)", "A loudness scale where +20 dB means 10 times the pressure swing. 0 dB SPL is the quietest sound people can hear."],
    ["Wavelength", "Distance between two squeezes: speed of sound ÷ frequency."],
    ["Harmonics", "Extra frequencies at whole-number multiples of the lowest one. They set the timbre."],
    ["Timbre", "The quality that makes a violin and a flute playing the same note sound different."],
  ],
  specs: [
    ["Speed of sound", "343 m/s (air, 20 °C)"],
    ["Human hearing", "about 20 Hz – 20 kHz"],
    ["Normal air pressure", "101,325 Pa"],
    ["Quietest audible", "20 µPa = 0 dB SPL"],
    ["Conversation", "≈ 60 dB SPL = 0.02 Pa"],
    ["Painful", "≈ 130 dB SPL = 63 Pa"],
  ],
  code: `import numpy as np

c   = 343.0            # speed of sound, m/s
f   = 440.0            # frequency, Hz (the note A)
spl = 70               # loudness, dB SPL

wavelength = c / f                     # 0.78 m
period     = 1 / f                     # 2.27 ms
pressure   = 20e-6 * 10 ** (spl / 20)  # 0.063 Pa (RMS)

t = np.arange(0, 0.01, 1 / 48000)      # 10 ms of time
p = pressure * np.sqrt(2) * np.sin(2 * np.pi * f * t)
print(wavelength, period, pressure)`,
  rate: () => ({ value: "analog", note: "continuous pressure" }),
  mount(ctx) {
    const { audio } = ctx;
    let f = 220, spl = 70, shape: Shape = "sine", t0 = 0;
    const amp = () => Math.min(0.45, 0.45 * 10 ** ((spl - 90) / 20));
    const play = () => { audio.playTone(f, amp(), shape); };
    const toggleTone = () => (audio.playing === "tone" ? audio.stop() : play());
    ctx.click("source", toggleTone, () => (audio.playing === "tone" ? "Click to stop the tone" : "Click to play a tone"));
    ctx.row("wave", "<b>Frequency</b> is how many times per second the air is squeezed. You hear it as pitch.",
      slider({ label: "Frequency", min: Math.log(40), max: Math.log(4000), step: 0.001, value: Math.log(f), fmt: (v) => fmtHz(Math.exp(v)), onInput: (v) => { f = Math.exp(v); audio.setTone(f, amp()); } }));
    ctx.row("bars", "<b>Amplitude</b> is how hard it's squeezed. You hear it as loudness, measured in decibels.",
      slider({ label: "Loudness", min: 30, max: 100, value: spl, fmt: (v) => `${v} dB SPL`, onInput: (v) => { spl = v; audio.setTone(f, amp()); } }));
    ctx.row("layers", "<b>Shape</b> changes the tone's colour without changing its pitch. Sharper shapes contain extra, higher frequencies called harmonics.",
      segmented<Shape>("Shape", [["sine", "Smooth"], ["sawtooth", "Bright"], ["square", "Hollow"]], shape, (v) => { shape = v; if (audio.playing === "tone") play(); }));
    const btn = button("▶ Play tone", toggleTone, "btn primary");
    ctx.row("speaker", "Click the speaker, or press play. To see the air in your own room, turn on the microphone in the bar under the machine.", btn);
    const sL = ctx.stat("Wavelength"), sP = ctx.stat("One period"), sPa = ctx.stat("Pressure swing");
    const off = audio.on(() => { btn.textContent = audio.playing === "tone" ? "■ Stop tone" : "▶ Play tone"; });
    ctx.callouts(sound.callouts.map((c) => c.at === "source.air" ? { ...c, value: () => `λ = ${(C / f).toFixed(2)} m at ${fmtHz(f)}` } : c));
    ctx.screen("source", (g, w, h, t) => {
      const u = unit(h);
      const live = audio.live && audio.playing !== "tone";
      head(g, w, h, live ? "Air pressure, live" : "Air pressure at one point", live ? "" : fmtHz(f));
      const x0 = 5 * u, ww = w - 10 * u, mid = 55 * u, A = 34 * u;
      g.strokeStyle = S.grid; g.lineWidth = 0.6 * u; g.beginPath(); g.moveTo(x0, mid); g.lineTo(x0 + ww, mid); g.stroke();
      screenText(g, "squeezed", x0, mid - A - 1 * u, 5.5 * u, S.dim);
      screenText(g, "stretched", x0, mid + A + 6 * u, 5.5 * u, S.dim);
      if (live) { trace(g, bus.time, x0, 18 * u, ww, 74 * u, S.teal, 0.8 * u, 2.5); return; }
      const cycles = 3;
      const a = Math.max(0.15, Math.min(1, 10 ** ((spl - 100) / 40)));
      const scroll = audio.playing === "tone" ? (t - t0) * 0.6 : 0;
      g.strokeStyle = S.teal; g.lineWidth = 1 * u; g.beginPath();
      for (let i = 0; i <= 400; i++) {
        const p = (i / 400) * cycles - scroll;
        const y = mid - SHAPES[shape](p) * A * a;
        i ? g.lineTo(x0 + (i / 400) * ww, y) : g.moveTo(x0, y);
      }
      g.stroke();
      // one period bracket
      const pw = ww / cycles, by = 88 * u;
      g.strokeStyle = S.orange; g.lineWidth = 0.6 * u;
      g.beginPath(); g.moveTo(x0, by - 2 * u); g.lineTo(x0, by); g.lineTo(x0 + pw, by); g.lineTo(x0 + pw, by - 2 * u); g.stroke();
      screenText(g, `1 period = ${(1000 / f).toFixed(2)} ms`, x0 + pw / 2, by + 7 * u, 5.5 * u, S.orange, "center");
    });
    const tick = ctx.world.onTick(() => {
      sL.set((C / f) >= 1 ? `${(C / f).toFixed(2)} m` : `${((C / f) * 100).toFixed(1)} cm`);
      sP.set(`${(1000 / f).toFixed(2)} ms`);
      sPa.set(`${(20e-6 * 10 ** (spl / 20)).toPrecision(2)} Pa`);
    });
    t0 = performance.now() / 1000;
    return () => { off(); tick(); };
  },
  run(ctx) {
    ctx.log("frequency   wavelength   period");
    for (const f of [100, 440, 1000, 4000, 10000]) ctx.log(`${String(f).padStart(6)} Hz   ${(C / f).toFixed(3).padStart(7)} m   ${(1000 / f).toFixed(3)} ms`);
    ctx.log("loudness → pressure swing (RMS)", "dim");
    for (const spl of [0, 30, 60, 94, 120]) ctx.log(`${String(spl).padStart(4)} dB SPL → ${(20e-6 * 10 ** (spl / 20)).toExponential(1)} Pa`);
    ctx.log("94 dB SPL is exactly 1 pascal; microphones are calibrated at that level.", "ok");
  },
};

// ---------------------------------------------------------------- 2 · microphone

type Kind = "condenser" | "dynamic" | "mems";
const KIND_TEXT: Record<Kind, string> = {
  condenser: "<b>Condenser:</b> the diaphragm is one plate of a capacitor and a fixed backplate is the other. When the gap changes, the voltage across them changes. Sensitive and detailed; used in studios.",
  dynamic: "<b>Dynamic:</b> the diaphragm is glued to a coil of wire that sits around a magnet. Moving the coil through the magnetic field makes a current, like a speaker run backwards. Rugged; used on stage.",
  mems: "<b>MEMS:</b> a condenser microphone etched into a silicon chip about 1 mm across, with its own amplifier, and often its own ADC, on the same chip. This is the microphone in phones, laptops and smart speakers.",
};

export const microphone: Lesson = {
  id: "microphone",
  short: "Microphone",
  title: "The microphone",
  chapter: "Capture",
  thumb: ["mic"],
  focus: ["mic"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "mic.grille", icon: "membrane", title: "Diaphragm", text: "A thin membrane behind the mesh. The air pushes it in and out by less than a micrometre.", slot: "tl" },
    { at: "mic.ring", icon: "bolt", title: "Level light", text: "Glows brighter as the voltage swings further. Try the mic button below.", slot: "bl" },
    { at: "mic.screen", icon: "screen", title: "Inside the capsule", text: "How the selected type turns movement into voltage. Click the microphone to switch type.", slot: "tr" },
  ],
  summary: "A microphone turns the movement of air into a matching electrical voltage. Every kind has a <b>diaphragm</b>, a membrane light enough for sound to move it. The kinds differ in how that movement becomes electricity.",
  steps: [
    "Sound pressure pushes the diaphragm in and out. For normal speech the movement is far smaller than the width of a hair.",
    "The diaphragm's position becomes a voltage. How depends on the type: a changing capacitor (condenser, MEMS) or a coil moving past a magnet (dynamic).",
    "The voltage is tiny, a few thousandths of a volt. A <b>preamplifier</b> boosts it so the converter in the next step can measure it.",
    "The amount of boost is the <b>gain</b>. Too little and quiet sounds sink into electrical hiss. Too much and loud sounds <b>clip</b>: the tops of the wave are cut flat.",
    "Phones and smart speakers combine 2 to 7 microphones. Comparing their timing lets software favour sound from one direction, a technique called <b>beamforming</b>.",
  ],
  lost: `<ul>
    <li><b>Direction.</b> One diaphragm measures pressure at one point, so a single-channel recording can't say where a sound came from.</li>
    <li><b>The very high and very low.</b> The diaphragm has mass, so it can't follow extremely fast changes, and small capsules respond weakly to deep bass.</li>
    <li><b>Quiet sounds.</b> The electronics add their own hiss (self-noise). A sound quieter than that hiss is gone. For phone microphones that's around 30 dB SPL.</li>
    <li><b>Peaks of loud sounds,</b> if the gain is set too high (clipping).</li>
    <li><b>What processing removes on purpose.</b> Calls and voice assistants usually apply echo cancellation, noise suppression and automatic gain. This site switches those off for your mic so you hear the raw signal.</li>
  </ul>`,
  words: [
    ["Diaphragm", "The thin membrane that moves with the air."],
    ["Transducer", "Any device that converts one kind of energy into another. Microphones and speakers are both transducers."],
    ["Preamplifier", "The circuit that boosts the microphone's tiny voltage."],
    ["Gain", "How much the preamplifier boosts the signal, in decibels."],
    ["Clipping", "When the signal goes past the largest value that can be recorded and gets cut off flat."],
    ["dBFS", "Decibels relative to full scale. 0 dBFS is the loudest value the system can store; everything else is negative."],
    ["Self-noise", "The hiss a microphone and its electronics make even in total silence."],
  ],
  specs: [
    ["Phone MEMS diaphragm", "≈ 0.5 mm"],
    ["Sensitivity", "≈ −38 dBV per pascal"],
    ["Self-noise (MEMS)", "≈ 29–35 dBA"],
    ["Overload", "≈ 120–135 dB SPL"],
    ["Digital MEMS output", "1-bit PDM at ≈ 1–3 MHz"],
    ["Mics in a smart speaker", "2–7"],
  ],
  code: `import sounddevice as sd, numpy as np

sr = 48000
x = sd.rec(sr, samplerate=sr, channels=1)[:, 0]   # 1 second
sd.wait()

peak = np.max(np.abs(x))
level = np.sqrt(np.mean(x ** 2))
clipped = np.mean(np.abs(x) >= 0.999)
print(f"peak  {20*np.log10(peak):.1f} dBFS")
print(f"level {20*np.log10(level):.1f} dBFS")
print(f"clipped {clipped:.2%} of samples")`,
  rate: () => ({ value: "analog", note: "a voltage of a few mV" }),
  mount(ctx) {
    const { audio } = ctx;
    let kind: Kind = "mems", gainDb = 0;
    const order: Kind[] = ["mems", "condenser", "dynamic"];
    const seg = segmented<Kind>("Type", [["mems", "MEMS"], ["condenser", "Condenser"], ["dynamic", "Dynamic"]], kind, (v) => { kind = v; desc.text(KIND_TEXT[v]); });
    ctx.click("mic", () => { kind = order[(order.indexOf(kind) + 1) % 3]; (seg.querySelectorAll("button")[order.indexOf(kind)] as HTMLButtonElement).click(); }, () => "Click to switch microphone type");
    ctx.row("mic", "<b>Microphone type.</b> Click the microphone in the scene to cycle through them.", seg);
    const desc = ctx.row("membrane", KIND_TEXT[kind]);
    const sPk = ctx.stat("Peak"), sClip = ctx.stat("Clipped", "lost"), sHiss = ctx.stat("Hiss vs signal");
    const process = () => {
      const x = monoAt(audio.clip, audio.clip.sr);
      const g = 10 ** (gainDb / 20);
      const r = rng(5);
      let clipped = 0, pk = 0;
      // preamp gain, then a recorder with a fixed hiss floor at −56 dBFS
      const y = x.map((v) => { let s = v * g; if (Math.abs(s) > 1) { clipped++; s = Math.sign(s); } pk = Math.max(pk, Math.abs(s)); return s + gaussian(r) * 0.0016; });
      return { y, clipped: clipped / x.length, pk, snr: db(rms(x) * g) - db(0.0016) };
    };
    const update = () => { const p = process(); sPk.set(`${db(p.pk).toFixed(1)} dBFS`); sClip.set(`${(p.clipped * 100).toFixed(1)} %`); sHiss.set(`${p.snr.toFixed(0)} dB apart`); };
    ctx.row("knob", "<b>Gain.</b> Too low and the sound sinks toward the hiss. Too high and the peaks clip. Listen at both ends; playback is turned back up to normal volume so you can hear the difference.",
      el("div", { class: "btns" },
        slider({ label: "Gain", min: -24, max: 30, value: 0, fmt: (v) => `${v > 0 ? "+" : ""}${v} dB`, onInput: (v) => { gainDb = v; update(); } }),
        button("▶ Hear at this gain", () => audio.playSignal([normalize(process().y, 0.8)], audio.clip.sr), "btn primary")));
    ctx.row("ear", "Press the microphone button in the bar under the machine to see your own voice on the monitor and the level light.");
    update();
    ctx.onChange(update);
    ctx.screen("mic", (g, w, h, t) => {
      const u = unit(h);
      head(g, w, h, kind === "mems" ? "MEMS capsule" : kind === "condenser" ? "Condenser capsule" : "Dynamic capsule", bus.live ? "live" : "");
      const v = bus.live ? Math.max(-1, Math.min(1, bus.time[bus.time.length - 1] * 6)) : Math.sin(t * 3) * 0.6;
      const cx = w * 0.42, cy = 52 * u, H = 62 * u, bend = v * 7 * u;
      // sound arriving from the left
      for (let k = 0; k < 4; k++) { g.strokeStyle = S.dim; g.globalAlpha = 0.6 - k * 0.12; g.lineWidth = 0.6 * u; g.beginPath(); g.arc(cx - 34 * u, cy, 8 * u + k * 7 * u + ((t * 20 * u) % (7 * u)), -0.5, 0.5); g.stroke(); }
      g.globalAlpha = 1;
      const dia = (x: number) => { g.strokeStyle = S.teal; g.lineWidth = 1.1 * u; g.beginPath(); g.moveTo(x, cy - H / 2); g.quadraticCurveTo(x + bend * 2, cy, x, cy + H / 2); g.stroke(); };
      if (kind === "dynamic") {
        g.fillStyle = "#3a4466"; g.fillRect(cx + 10 * u, cy - 14 * u, 22 * u, 28 * u);
        g.fillStyle = S.dim; g.fillRect(cx + 14 * u, cy - 6 * u, 18 * u, 12 * u);
        g.strokeStyle = S.orange; g.lineWidth = 1 * u;
        for (let k = 0; k < 5; k++) { const x = cx + 4 * u + bend + k * 1.8 * u; g.beginPath(); g.moveTo(x, cy - 10 * u); g.lineTo(x, cy + 10 * u); g.stroke(); }
        screenText(g, "coil", cx + 7 * u + bend, cy - 13 * u, 5 * u, S.orange, "center");
        screenText(g, "magnet", cx + 21 * u, cy + 21 * u, 5 * u, S.dim, "center");
        dia(cx);
      } else {
        const gap = kind === "mems" ? 8 * u : 12 * u;
        g.fillStyle = "#3a4466";
        for (let k = 0; k < 9; k++) if (k % 2 === 0) g.fillRect(cx + gap, cy - H / 2 + (k * H) / 9, 3 * u, H / 9 - 1 * u);
        dia(cx);
        g.strokeStyle = S.orange; g.setLineDash([1.5 * u, 1.5 * u]); g.lineWidth = 0.6 * u;
        g.beginPath(); g.moveTo(cx + bend, cy); g.lineTo(cx + gap, cy); g.stroke(); g.setLineDash([]);
        screenText(g, "backplate", cx + gap + 4 * u, cy - H / 2 + 4 * u, 5 * u, S.dim);
        screenText(g, "gap → voltage", cx + gap + 4 * u, cy + 2 * u, 5 * u, S.orange);
      }
      screenText(g, "diaphragm", cx, cy + H / 2 + 7 * u, 5 * u, S.teal, "center");
      // voltage readout
      const vx = w * 0.7;
      trace(g, bus.live ? bus.time.subarray(bus.time.length - 600) : Float32Array.from({ length: 200 }, (_, i) => Math.sin(i * 0.12 + t * 6) * 0.5), vx, 22 * u, w - vx - 4 * u, 60 * u, S.ink, 0.6 * u, bus.live ? 4 : 1);
      screenText(g, "voltage", vx, 92 * u, 5 * u, S.dim);
    });
    return undefined;
  },
  async run(ctx) {
    const a = ctx.audio;
    if (!a.live) { ctx.log("Nothing is playing, so playing the current sound to measure it…", "dim"); a.playClip(); }
    const buf = new Float32Array(2048);
    let sum = 0, n = 0, peak = 0, clip = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      a.timeData(buf);
      for (const v of buf) { sum += v * v; n++; peak = Math.max(peak, Math.abs(v)); if (Math.abs(v) >= 0.999) clip++; }
      await new Promise((r) => setTimeout(r, 40));
    }
    ctx.log(`peak    ${db(peak).toFixed(1)} dBFS`);
    ctx.log(`level   ${db(Math.sqrt(sum / n)).toFixed(1)} dBFS`);
    ctx.log(`clipped ${((100 * clip) / n).toFixed(2)} % of samples`);
    ctx.log("0 dBFS is the loudest value that can be stored. Speech recorded well peaks around −12 to −6 dBFS.", "ok");
  },
};

// ---------------------------------------------------------------- 3 · sampling

const RATES = [8000, 16000, 24000, 44100, 48000];

export const sampling: Lesson = {
  id: "sampling",
  short: "Sampling",
  title: "Sampling: measuring many times a second",
  chapter: "Capture",
  thumb: ["adc"],
  focus: ["adc"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "adc.clock", icon: "clock", title: "Crystal clock", text: "Ticks at a steady rate. Each tick triggers one measurement. Click it to change the rate.", slot: "bl" },
    { at: "adc.chip", icon: "chip", title: "ADC chip", text: "Analog-to-digital converter: measures the voltage and writes it down as a number.", slot: "br" },
    { at: "adc.screen", icon: "dots", title: "Samples", text: "Orange dots are measurements. The dashed line is the wave they imply.", slot: "tr" },
    { at: "adc.input", icon: "bolt", title: "Analog input", text: "The continuous voltage from the microphone.", slot: "tl" },
  ],
  summary: "A computer can only store a list of numbers, so the <b>ADC</b> measures the microphone's voltage at evenly spaced instants. Each measurement is a <b>sample</b>, and the number of samples per second is the <b>sample rate</b>. The rate decides the highest pitch that can be recorded.",
  steps: [
    "A crystal clock ticks at the sample rate, for example 16,000 times per second.",
    "On each tick the converter freezes the voltage for an instant and measures it.",
    "The result is a list of numbers. One second at 16 kHz is 16,000 numbers.",
    "The <b>Nyquist–Shannon theorem</b>: if a sound contains only frequencies below half the sample rate (the <b>Nyquist frequency</b>), the original wave can be rebuilt exactly from the samples.",
    "A frequency above Nyquist doesn't vanish. It shows up as a false, lower frequency called an <b>alias</b>: a tone at f sampled at fs is heard at |f − fs × round(f ÷ fs)|. An 11 kHz tone sampled at 16 kHz is heard at 5 kHz.",
    "So a real converter first removes everything above Nyquist with a low-pass filter. The high sound is then removed instead of being heard at the wrong pitch.",
    "Speech models almost all use <b>16 kHz</b>, which keeps everything below 8 kHz. That's enough to understand words.",
  ],
  lost: `<ul>
    <li><b>Everything above half the sample rate.</b> At 48 kHz that's above 24 kHz, beyond human hearing. At the 16 kHz used by speech models it's everything above 8 kHz: the hiss of "s" and "sh", cymbals, most birdsong, and the airy brightness of a recording.</li>
  </ul>
  <p>Try it: choose <b>Birdsong</b>, set 16 kHz with the filter on, and press <b>Hear at this rate</b>.</p>`,
  words: [
    ["Analog", "Continuous: can take any value at any moment."],
    ["Digital", "Stored as a list of separate numbers."],
    ["Sample", "One measurement of the voltage at one instant."],
    ["Sample rate", "Samples per second, in hertz. 16 kHz = 16,000 per second."],
    ["Nyquist frequency", "Half the sample rate: the highest frequency that can be recorded correctly."],
    ["Aliasing", "A frequency above Nyquist appearing as a false, lower one."],
    ["Anti-aliasing filter", "A filter that removes frequencies above Nyquist before sampling."],
    ["Resampling", "Converting a recording from one sample rate to another (filter first, then recompute the samples)."],
  ],
  specs: [
    ["Telephone", "8 kHz → up to 4 kHz"],
    ["Speech models (Whisper etc.)", "16 kHz → up to 8 kHz"],
    ["Mimi, EnCodec", "24 kHz → up to 12 kHz"],
    ["CD", "44.1 kHz → up to 22.05 kHz"],
    ["Browsers, phones, video", "48 kHz → up to 24 kHz"],
  ],
  code: `import numpy as np
from scipy.signal import resample_poly

fs_in, fs = 48000, 16000
f = 11000                           # above the new Nyquist (8 kHz)

alias = abs(f - fs * round(f / fs))
print("heard as", alias, "Hz")      # 5000 Hz

t = np.arange(fs_in) / fs_in
x = np.sin(2 * np.pi * f * t)
bad  = x[::3]                       # keep every 3rd sample: aliases
good = resample_poly(x, 1, 3)       # low-pass first: the tone is removed
print(np.abs(bad).max(), np.abs(good).max())`,
  rate: (p) => ({ value: fmtBits(p.sr * p.bits), note: `${p.sr / 1000} kHz × ${p.bits} bit × mono` }),
  mount(ctx) {
    const { audio } = ctx;
    let f = 3000, aa = true;
    const fs = () => ctx.pipe().sr;
    const seg = segmented("Sample rate", RATES.map((r) => [String(r), `${r / 1000} kHz`] as [string, string]), String(fs()), (v) => ctx.setPipe({ sr: Number(v) }));
    ctx.click("adc", (part) => {
      if (part !== "clock" && part !== "chip") return;
      const next = RATES[(RATES.indexOf(fs()) + 1) % RATES.length];
      (seg.querySelectorAll("button")[RATES.indexOf(next)] as HTMLButtonElement).click();
    }, (part) => (part === "clock" || part === "chip" ? "Click to change the sample rate" : null));
    ctx.row("clock", "<b>Sample rate.</b> Click the crystal clock on the board, or choose a rate. This setting carries forward to every later station.", seg);
    ctx.row("wave", "<b>Test tone.</b> Drag it up past the red line on the monitor. That line is the Nyquist frequency, half the sample rate.",
      slider({ label: "Tone", min: 200, max: 30000, step: 50, value: f, fmt: fmtHz, onInput: (v) => (f = v) }));
    ctx.row("filter", "<b>Anti-aliasing filter.</b> Real converters remove everything above Nyquist first. Switch it off to see and hear what that prevents.", toggle("Filter on", aa, (v) => (aa = v)));
    ctx.row("ear", "<b>Listen.</b> For a clear demonstration choose <i>Sweep</i>, set 8 kHz and switch the filter off: the rising tone folds back down several times.",
      el("div", { class: "btns" },
        button("▶ Hear at this rate", () => { const x = monoAt(audio.clip, audio.clip.sr); audio.playSignal([resample(x, audio.clip.sr, fs(), aa)], fs()); }, "btn primary"),
        button("▶ Original", () => audio.playClip(), "btn")));
    const sN = ctx.stat("Nyquist"), sA = ctx.stat("Tone heard as"), sR = ctx.stat("Data rate");
    ctx.callouts(sampling.callouts.map((c) => (c.at === "adc.clock" ? { ...c, value: () => `${fmtN(fs())} ticks per second` } : c)));
    const tick = ctx.world.onTick(() => {
      const nyq = fs() / 2, fa = Math.abs(f - fs() * Math.round(f / fs()));
      sN.set(fmtHz(nyq));
      sA.set(aa && f > nyq ? "removed" : fmtHz(fa));
      sR.set(fmtBits(fs() * ctx.pipe().bits));
    });
    ctx.screen("adc", (g, w, h) => {
      const u = unit(h);
      const sr = fs(), nyq = sr / 2;
      const k = Math.round(f / sr), fa = Math.abs(f - k * sr), sign = f - k * sr >= 0 ? 1 : -1;
      const gone = aa && f > nyq;
      head(g, w, h, "2 milliseconds of the test tone", gone ? "filtered out" : f > nyq ? `alias: ${fmtHz(fa)}` : fmtHz(f), gone ? S.red : f > nyq ? S.red : S.teal);
      const T = 0.002, x0 = 4 * u, ww = w - 8 * u, mid = 40 * u, A = 22 * u;
      g.strokeStyle = S.grid; g.lineWidth = 0.4 * u; g.beginPath(); g.moveTo(x0, mid); g.lineTo(x0 + ww, mid); g.stroke();
      // the real tone
      g.strokeStyle = gone ? "#3a4466" : "#6c7a9e"; g.lineWidth = 0.6 * u; g.beginPath();
      const steps = Math.ceil(ww);
      for (let i = 0; i <= steps; i++) { const tt = (i / steps) * T; const y = mid - Math.sin(2 * Math.PI * f * tt) * A; i ? g.lineTo(x0 + (i / steps) * ww, y) : g.moveTo(x0, y); }
      g.stroke();
      if (!gone) {
        g.strokeStyle = f > nyq ? S.red : S.teal; g.lineWidth = 0.9 * u; g.setLineDash(f > nyq ? [2 * u, 1.5 * u] : []);
        g.beginPath();
        for (let i = 0; i <= 400; i++) { const tt = (i / 400) * T; const y = mid - sign * Math.sin(2 * Math.PI * fa * tt) * A; i ? g.lineTo(x0 + (i / 400) * ww, y) : g.moveTo(x0, y); }
        g.stroke(); g.setLineDash([]);
      }
      const n = Math.floor(T * sr);
      for (let i = 0; i <= n; i++) {
        const tt = i / sr, px = x0 + (tt / T) * ww, v = gone ? 0 : Math.sin(2 * Math.PI * f * tt), py = mid - v * A;
        g.strokeStyle = S.dim; g.lineWidth = 0.3 * u; g.beginPath(); g.moveTo(px, mid); g.lineTo(px, py); g.stroke();
        g.fillStyle = S.orange; g.beginPath(); g.arc(px, py, (n > 60 ? 0.9 : 1.4) * u, 0, 7); g.fill();
      }
      // frequency line with the folding
      const y = 86 * u, maxF = 32000, X = (hz: number) => x0 + (hz / maxF) * ww;
      g.fillStyle = "#3b2a3a"; g.fillRect(X(nyq), y - 14 * u, ww - (X(nyq) - x0), 14 * u);
      g.strokeStyle = S.ink; g.lineWidth = 0.4 * u; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + ww, y); g.stroke();
      for (let hz = 0; hz <= maxF; hz += 8000) screenText(g, `${hz / 1000}k`, X(hz), y + 7 * u, 4.6 * u, S.dim, "center", true);
      g.strokeStyle = S.red; g.lineWidth = 0.7 * u; g.beginPath(); g.moveTo(X(nyq), y - 14 * u); g.lineTo(X(nyq), y); g.stroke();
      screenText(g, "Nyquist", X(nyq) + 1.2 * u, y - 10 * u, 4.6 * u, S.red);
      g.fillStyle = "#6c7a9e"; g.beginPath(); g.arc(X(f), y - 3 * u, 1.6 * u, 0, 7); g.fill();
      if (!gone && f > nyq) {
        g.strokeStyle = S.red; g.lineWidth = 0.5 * u; g.setLineDash([1.2 * u, 1 * u]);
        g.beginPath(); g.moveTo(X(f), y - 3 * u); g.quadraticCurveTo((X(f) + X(fa)) / 2, y - 18 * u, X(fa), y - 3 * u); g.stroke(); g.setLineDash([]);
        g.fillStyle = S.red; g.beginPath(); g.arc(X(fa), y - 3 * u, 1.6 * u, 0, 7); g.fill();
      }
    });
    return () => tick();
  },
  run(ctx) {
    const a = ctx.audio;
    const x = monoAt(a.clip, a.clip.sr);
    ctx.log(`"${a.clip.name}" recorded at ${a.clip.sr} Hz, ${fmtN(x.length)} samples`);
    for (const fs of [8000, 16000, 24000]) {
      const y = resample(x, a.clip.sr, fs, true);
      const kept = rms(y) / Math.max(1e-9, rms(x));
      const lost = Math.max(0, 1 - kept * kept);
      ctx.log(`${String(fs / 1000).padStart(4)} kHz: ${fmtN(y.length).padStart(7)} samples · energy above ${fs / 2000} kHz removed: ${(lost * 100).toFixed(1)} %`, lost > 0.05 ? "warn" : "info");
    }
    ctx.log("Speech keeps nearly all its energy at 16 kHz. Birdsong and cymbals don't.", "ok");
  },
};

// ---------------------------------------------------------------- 4 · bit depth

const BITS = [4, 8, 12, 16, 24];

export const bits: Lesson = {
  id: "bits",
  short: "Bit depth",
  title: "Bit depth: how precise each measurement is",
  chapter: "Capture",
  thumb: ["adc"],
  focus: ["adc"],
  view: { fill: 0.74, offset: [0, 0.03] },
  callouts: [
    { at: "adc.chip", icon: "stairs", title: "Rounding", text: "Each measurement is rounded to the nearest of 2ⁿ allowed levels. Click the chip to change n.", slot: "br" },
    { at: "adc.screen", icon: "screen", title: "Staircase", text: "Grey: the real wave. White steps: what gets stored. Red: the rounding error.", slot: "tr" },
  ],
  summary: "Each sample is stored with a fixed number of <b>bits</b>. With 16 bits there are 65,536 possible values, so the true voltage gets rounded to the nearest one. The rounding errors add up to a faint hiss, and every bit you remove makes that hiss twice as loud.",
  steps: [
    "With <b>n bits</b> a sample can take 2ⁿ values: 8 bits gives 256, 16 bits gives 65,536, 24 bits gives about 16.7 million.",
    "The converter rounds each measurement to the nearest allowed value. The difference, at most half a step, is the <b>quantization error</b>.",
    "Each extra bit halves the step, so the error drops by about 6 dB. For a full-scale tone the signal-to-noise ratio is about 6.02 × n + 1.76 dB: 98 dB at 16 bits.",
    "With very few bits the error follows the signal and sounds like harsh distortion. Adding a tiny amount of random noise before rounding, called <b>dither</b>, turns it back into plain hiss. Try 3 bits with dither on and off.",
    "Models don't use the integers directly. A 16-bit value is divided by 32,768 to give a decimal number between −1 and 1, and all later arithmetic uses those decimals.",
  ],
  lost: `<ul>
    <li><b>Detail below the noise floor.</b> At 16 bits that floor is about 96 dB below the loudest storable sound: quieter than any real room, so the loss is inaudible.</li>
    <li><b>Peaks above full scale.</b> Anything louder than the largest value is clipped.</li>
  </ul>
  <p>From here on the sound is a list of numbers on a computer. Every later loss comes from a choice about what to keep.</p>`,
  words: [
    ["Bit", "A single 0 or 1. n bits can represent 2ⁿ different values."],
    ["Bit depth", "How many bits each sample uses."],
    ["Quantization", "Rounding a measurement to one of a fixed set of values."],
    ["Quantization error", "The difference between the true value and the rounded one."],
    ["SNR", "Signal-to-noise ratio: how much louder the signal is than the noise, in dB."],
    ["Dither", "A little random noise added before rounding so the error becomes steady hiss instead of distortion."],
    ["PCM", "Pulse-code modulation: audio stored as a plain list of samples. WAV files hold PCM."],
  ],
  specs: [
    ["8-bit", "256 levels · ≈ 50 dB"],
    ["16-bit (CD, most models)", "65,536 levels · ≈ 98 dB"],
    ["24-bit (studio)", "16.7 M levels · ≈ 146 dB"],
    ["Telephone (μ-law)", "8-bit, finer steps for quiet sounds"],
    ["Inside a model", "32-bit floats, x ÷ 32,768"],
  ],
  code: `import numpy as np

def quantize(x, bits, dither=False):
    step = 2.0 / 2 ** bits
    if dither:                                   # ±1 step of noise
        x = x + (np.random.rand(*x.shape) - np.random.rand(*x.shape)) * step
    idx = np.clip(np.floor((x + 1) / step), 0, 2 ** bits - 1)
    return -1 + (idx + 0.5) * step

for bits in [2, 4, 8, 12, 16]:
    e = x - quantize(x, bits)
    snr = 10 * np.log10(np.sum(x ** 2) / np.sum(e ** 2))
    print(f"{bits:2d} bits: {snr:5.1f} dB")`,
  rate: (p) => ({ value: fmtBits(p.sr * p.bits), note: `${p.sr / 1000} kHz × ${p.bits} bit × mono` }),
  mount(ctx) {
    const { audio } = ctx;
    let dither = false;
    const nb = () => ctx.pipe().bits;
    const bS = slider({ label: "Bits", min: 1, max: 24, value: nb(), fmt: (v) => `${v} bit`, onInput: (v) => ctx.setPipe({ bits: v }) });
    ctx.click("adc", (part) => { if (part !== "chip" && part !== "clock") return; const next = BITS.find((b) => b > nb()) ?? BITS[0]; ctx.setPipe({ bits: next }); bS.set(next); }, (part) => (part === "chip" ? "Click to change the bit depth" : null));
    ctx.row("stairs", "<b>Bits per sample.</b> Drag down and watch the staircase on the monitor get coarser. This setting carries forward to later stations.", bS);
    ctx.row("filter", "<b>Dither.</b> At 2–4 bits, compare with it on and off. Without it you hear distortion that follows the sound; with it, a steady hiss.", toggle("Dither", dither, (v) => (dither = v)));
    const dq = (x: Float32Array, b: number) => { if (!dither) return quantize(x, b); const r = rng(1), step = 2 / 2 ** b; return quantize(x.map((v) => v + (r() - r()) * step), b); };
    ctx.row("ear", "<b>Listen</b> to the current sound stored at this bit depth.",
      el("div", { class: "btns" }, button("▶ Hear it", () => audio.playSignal([dq(monoAt(audio.clip, audio.clip.sr), nb())], audio.clip.sr), "btn primary"), button("▶ Original", () => audio.playClip(), "btn")));
    const sLv = ctx.stat("Levels"), sSnr = ctx.stat("Measured SNR"), sR = ctx.stat("Data rate");
    let seg: Float32Array = new Float32Array(1), snrKey = "";
    const pickSeg = () => {
      const x = monoAt(audio.clip, audio.clip.sr), n = Math.floor(0.006 * audio.clip.sr);
      let best = 0, bv = -1;
      for (let i = 0; i + n < x.length; i += n) { const r = rms(x, i, i + n); if (r > bv) { bv = r; best = i; } }
      seg = x.slice(best, best + n);
    };
    pickSeg();
    ctx.onChange(pickSeg);
    const tick = ctx.world.onTick(() => {
      const b = nb();
      sLv.set(fmtN(2 ** b));
      sR.set(fmtBits(ctx.pipe().sr * b));
      const key = `${audio.clip.id}|${b}|${dither}`;
      if (key !== snrKey) {
        snrKey = key;
        const x = monoAt(audio.clip, audio.clip.sr), q = dq(x, b);
        let ss = 0, se = 0;
        for (let i = 0; i < x.length; i++) { ss += x[i] ** 2; se += (x[i] - q[i]) ** 2; }
        sSnr.set(`${(10 * Math.log10(ss / Math.max(se, 1e-20))).toFixed(1)} dB`);
      }
    });
    ctx.screen("adc", (g, w, h) => {
      const u = unit(h);
      const b = nb(), levels = 2 ** b, step = 2 / levels;
      head(g, w, h, `6 ms of "${audio.clip.name}"`, `${fmtN(levels)} levels`);
      const q = dq(seg, b);
      const x0 = 4 * u, ww = w - 8 * u, y0 = 16 * u, hh = 58 * u;
      if (levels <= 64) { g.strokeStyle = "#26314f"; g.lineWidth = 0.3 * u; for (let l = 0; l <= levels; l++) { const yy = y0 + (l / levels) * hh; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x0 + ww, yy); g.stroke(); } }
      trace(g, seg, x0, y0, ww, hh, "#6c7a9e", 0.9 * u);
      g.strokeStyle = S.ink; g.lineWidth = 0.8 * u; g.beginPath();
      for (let i = 0; i < q.length; i++) { const px = x0 + (i / q.length) * ww, nx = x0 + ((i + 1) / q.length) * ww, py = y0 + hh / 2 - q[i] * (hh / 2); i ? g.lineTo(px, py) : g.moveTo(px, py); g.lineTo(nx, py); }
      g.stroke();
      const e = seg.map((v, i) => v - q[i]);
      trace(g, e, x0, 78 * u, ww, 18 * u, S.red, 0.6 * u, 1 / step);
      screenText(g, `error (magnified ×${fmtN(1 / step)})`, x0, 77 * u, 4.6 * u, S.red);
    });
    return () => tick();
  },
  run(ctx) {
    const x = monoAt(ctx.audio.clip, ctx.audio.clip.sr);
    let ss = 0; for (const v of x) ss += v * v;
    ctx.log("bits   levels        SNR (measured)   SNR (full-scale tone)");
    for (const b of [1, 2, 4, 8, 12, 16, 24]) {
      const q = quantize(x, b);
      let se = 0; for (let i = 0; i < x.length; i++) se += (x[i] - q[i]) ** 2;
      ctx.log(`${String(b).padStart(3)}   ${fmtN(2 ** b).padStart(10)}   ${(10 * Math.log10(ss / Math.max(se, 1e-20))).toFixed(1).padStart(8)} dB        ${(6.02 * b + 1.76).toFixed(1)} dB`);
    }
    ctx.log("Measured SNR is lower than the formula when the sound doesn't use the full range.", "ok");
  },
};
