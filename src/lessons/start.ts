import type { Lesson } from "../types";
import { button } from "../ui/dom";
import { ORDER } from "../scene/stations";
import { stages, fmtBits } from "./kit";
import { softmax } from "./understand";

/** Which lesson each station's tag opens. */
export const STATION_LESSON: Record<string, string> = {
  source: "sound", mic: "microphone", adc: "sampling", fft: "spectrum", mel: "mel", encoder: "encoder",
  tokens: "tokens", projector: "projector", lm: "attention", head: "head", voice: "moshi",
};
const NAMES: Record<string, string> = {
  source: "Sound", mic: "Microphone", adc: "ADC", fft: "Spectrum", mel: "Mel bands", encoder: "Encoder",
  tokens: "Tokens", projector: "Projector", lm: "Language model", head: "Output", voice: "Talking back",
};

export const start: Lesson = {
  id: "intro",
  short: "Start",
  intro: true,
  title: "How a computer hears you",
  chapter: "Start",
  thumb: ["source", "mic"],
  focus: ORDER,
  view: { fill: 0.94, yaw: 22 },
  callouts: [
    { at: "source.cabinet", icon: "speaker", title: "Sound goes in here", text: "A speaker plays the current sound, or you record your own.", slot: "tl" },
    { at: "head.screen", icon: "screen", title: "An answer comes out here", text: "After ten steps, a model says what it heard.", slot: "bl" },
  ],
  summary: "A computer can't hear. It measures air pressure thousands of times a second and does arithmetic on the measurements. This machine shows every step in order, from the speaker on the left to the model's answer at the end, using whatever sound you give it.",
  steps: [
    "<b>Source.</b> A speaker, or your voice, pushes on the air and makes pressure waves.",
    "<b>Microphone.</b> A thin membrane follows the air and produces a matching electrical voltage.",
    "<b>ADC.</b> A converter measures that voltage 16,000 times a second and writes each measurement as a number.",
    "<b>Spectrum.</b> The numbers are cut into 25-millisecond slices, and each slice is split into the pitches it contains.",
    "<b>Mel bands.</b> Those pitches are grouped into 80 bands spaced the way human hearing is, producing a picture of the sound.",
    "<b>Encoder.</b> A neural network turns every 20 ms of that picture into a list of 1,280 numbers that describe it.",
    "<b>Tokens.</b> Some systems replace each list with a few whole numbers looked up in a fixed codebook.",
    "<b>Projector.</b> A small network resizes the lists so they match the language model's word vectors.",
    "<b>Language model.</b> Reads the audio and your question together, layer by layer.",
    "<b>Output.</b> The model's last layer picks the next word, or the next sound, to produce.",
  ],
  lost: `
    <p>Every station keeps less of the original sound than the one before it. Some of that is physics, some is engineering, and some is a choice about what the model is for.</p>
    <p>Watch the <b>Data rate here</b> card at the top as you go. A 48 kHz stereo recording is about 2.3 million bits per second. A transcript of the same speech is about 50.</p>
    <p>Each lesson has a red <b>What's lost</b> tab, and lesson 7 lets you hear the losses stacked together.</p>`,
  words: [
    ["Signal", "Anything that changes over time and carries information. Here: air pressure, then voltage, then numbers."],
    ["Sample", "One measurement of the signal at one instant."],
    ["Spectrogram", "A picture of sound: time left to right, pitch bottom to top, loudness as colour."],
    ["Model", "A program whose behaviour was learned from examples rather than written by hand."],
    ["Token", "One unit a language model reads or writes: a piece of a word, or a chunk of audio."],
    ["Pipeline", "The chain of steps a sound passes through. Each step's output is the next step's input."],
  ],
  specs: [
    ["Lessons", "17, in 6 chapters"],
    ["Stations", "11"],
    ["Sounds", "7 built in, your mic, or a file"],
    ["Runs on", "Web Audio + TypeScript, no server"],
    ["Keys", "Space play · R run · ← → lessons"],
  ],
  code: `# The whole journey in nine lines (each lesson expands one)
import sounddevice as sd, librosa, whisper

x = sd.rec(4 * 16000, samplerate=16000, channels=1)[:, 0]   # mic + ADC
sd.wait()
model = whisper.load_model("base")
mel = whisper.log_mel_spectrogram(whisper.pad_or_trim(x))    # spectrum + mel
h = model.encoder(mel[None])                                # encoder
text = model.decode(mel, whisper.DecodingOptions()).text     # LM + head
print(text)`,
  rate: () => ({ value: "2.3 M → 50 b/s", note: "recording to transcript" }),
  mount(ctx) {
    const setTags = (lit: string[] = []) => ctx.setTags(ORDER.map((id, i) => ({ station: id, num: i + 1, label: NAMES[id], lit: lit.includes(id), onClick: () => ctx.go(STATION_LESSON[id]) })));
    setTags();
    const sSound = ctx.stat("Sound"), sLen = ctx.stat("Length"), sGuess = ctx.stat("Model's guess", "keep");
    const refresh = () => {
      const a = ctx.analysis();
      sSound.set(a.clip.name);
      sLen.set(`${(a.clip.channels[0].length / a.clip.sr).toFixed(1)} s`);
      const p = softmax(a.labels.map((l) => l.logit));
      const best = p.indexOf(Math.max(...p));
      sGuess.set(`${a.labels[best].name} ${(p[best] * 100).toFixed(0)}%`);
    };
    refresh();
    ctx.onChange(refresh);
    const send = async () => {
      const lit: string[] = [];
      const a = ctx.analysis();
      const st = stages(a, ctx.pipe());
      ctx.log(`Sending "${a.clip.name}" through the machine…`, "head");
      await ctx.flow({
        per: 0.75,
        onStation: (id) => {
          lit.push(id);
          setTags(lit);
          const s = st.find((x) => x.station === id);
          if (s) ctx.log(`${s.name.padEnd(15)} ${s.shape.padEnd(26)} ${fmtBits(s.bps)}`);
        },
      });
      ctx.log("Done. Click any numbered tag to see how that station works.", "ok");
    };
    ctx.row("mic", "<b>Record yourself.</b> Speak, sing or clap for 4 seconds, then watch your recording travel through all ten stations.",
      button("● Record and send it through", async () => {
        try { ctx.log("Recording for 4 seconds…", "info"); await ctx.audio.record(4); await send(); } catch { ctx.log("The microphone isn't available (permission denied or no device).", "warn"); }
      }, "btn teal big"));
    ctx.row("play", "<b>Or use a built-in sound.</b> Choose one in the bar under the machine, then:", button("▶ Send the current sound through", () => void send(), "btn primary"));
    ctx.row("target", "<b>Click a numbered tag</b> on the machine to open that station's lesson. The lessons go in order, and each one builds on the one before.");
    ctx.row("screen", "<b>Everything on the machine shows your sound:</b> the monitors, the printed spectrogram, the encoder plates and the token tiles.");
    return () => ctx.setTags([]);
  },
  run(ctx) {
    const a = ctx.analysis();
    ctx.log(`"${a.clip.name}" through the current pipeline:`);
    ctx.log("station          holds                     shape                      rate");
    for (const s of stages(a, ctx.pipe())) ctx.log(`${s.name.padEnd(16)} ${s.holds.padEnd(25)} ${s.shape.padEnd(26)} ${fmtBits(s.bps)}`);
    ctx.log("Each row is the input to the next one.", "ok");
  },
};
