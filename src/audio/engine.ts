import { SPECIMENS, SPEC_SR } from "./specimens";
import { mixMono, resample } from "../dsp/signal";

export interface Clip {
  name: string;
  sr: number;
  channels: Float32Array[];
  source: "specimen" | "file" | "mic";
  id: string;
}

type Listener = () => void;
const MAX_CLIP_S = 6;

/**
 * One place that owns the AudioContext: the current clip, the microphone, and a single
 * analyser that every visual reads from, whatever is making sound.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  clip: Clip;
  micOn = false;
  playing: "clip" | "tone" | "processed" | null = null;
  private out: GainNode | null = null;
  private node: AudioScheduledSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  private tap: ScriptProcessorNode | null = null;
  private recording: Float32Array[] | null = null;
  private startedAt = 0;
  private playDur = 0;
  private listeners = new Set<Listener>();
  private cache = new Map<string, Clip>();
  private monoCache = new Map<string, Float32Array>();
  toneOsc: OscillatorNode | null = null;
  toneGain: GainNode | null = null;

  constructor() {
    this.clip = this.specimen("voice");
  }

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { this.listeners.forEach((f) => f()); }

  ensure(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx = ctx;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0;
      this.out = ctx.createGain();
      this.out.connect(ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get sampleRate() { return this.ctx?.sampleRate ?? 48000; }

  specimen(id: string): Clip {
    let c = this.cache.get(id);
    if (!c) {
      const s = SPECIMENS.find((x) => x.id === id) ?? SPECIMENS[0];
      c = { name: s.name, sr: SPEC_SR, channels: s.make(), source: "specimen", id: s.id };
      this.cache.set(id, c);
    }
    return c;
  }

  setClip(c: Clip) {
    this.stop();
    this.clip = c;
    this.emit();
  }

  useSpecimen(id: string) { this.setClip(this.specimen(id)); }

  async loadFile(file: File) {
    const ctx = this.ensure();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const len = Math.min(buf.length, Math.floor(buf.sampleRate * MAX_CLIP_S));
    const channels: Float32Array[] = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) channels.push(buf.getChannelData(c).slice(0, len));
    if (channels.length === 1) channels.push(channels[0]);
    this.setClip({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 24), sr: buf.sampleRate, channels, source: "file", id: `file:${file.name}:${Date.now()}` });
  }

  /** Clip as one channel at a given rate (cached), trimmed to MAX_CLIP_S. */
  mono(sr = this.clip.sr): Float32Array {
    const key = `${this.clip.id}@${sr}`;
    let m = this.monoCache.get(key);
    if (!m) {
      m = resample(mixMono(this.clip.channels), this.clip.sr, sr);
      this.monoCache.set(key, m);
    }
    return m;
  }

  get duration() { return this.clip.channels[0].length / this.clip.sr; }

  private buffer(channels: Float32Array[], sr: number): AudioBuffer {
    const ctx = this.ensure();
    const b = ctx.createBuffer(channels.length, channels[0].length, sr);
    channels.forEach((c, i) => b.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return b;
  }

  private start(src: AudioScheduledSourceNode, kind: "clip" | "tone" | "processed", dur: number) {
    this.stop();
    src.connect(this.analyser!);
    src.connect(this.out!);
    src.start();
    src.onended = () => { if (this.node === src) { this.node = null; this.playing = null; this.emit(); } };
    this.node = src;
    this.playing = kind;
    this.startedAt = this.ctx!.currentTime;
    this.playDur = dur;
    this.emit();
  }

  playClip() {
    const ctx = this.ensure();
    const s = ctx.createBufferSource();
    s.buffer = this.buffer(this.clip.channels, this.clip.sr);
    this.start(s, "clip", this.duration);
  }

  /** Play any processed signal (mono or stereo) at any sample rate the browser accepts. */
  playSignal(channels: Float32Array[], sr: number) {
    const ctx = this.ensure();
    const s = ctx.createBufferSource();
    s.buffer = this.buffer(channels, Math.max(3000, Math.min(384000, sr)));
    this.start(s, "processed", channels[0].length / sr);
  }

  playTone(freq: number, amp = 0.3, type: OscillatorType = "sine") {
    const ctx = this.ensure();
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(amp, ctx.currentTime, 0.02);
    o.connect(g);
    this.stop();
    g.connect(this.analyser!);
    g.connect(this.out!);
    o.start();
    this.node = o;
    this.toneOsc = o;
    this.toneGain = g;
    this.playing = "tone";
    this.startedAt = ctx.currentTime;
    this.playDur = Infinity;
    this.emit();
  }

  setTone(freq: number, amp: number) {
    if (!this.toneOsc || !this.ctx) return;
    this.toneOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.03);
    this.toneGain?.gain.setTargetAtTime(amp, this.ctx.currentTime, 0.03);
  }

  stop() {
    if (this.node) {
      const n = this.node;
      this.node = null;
      try { n.onended = null; n.stop(); } catch { /* already stopped */ }
      n.disconnect();
    }
    this.toneGain?.disconnect();
    this.toneOsc = null;
    this.toneGain = null;
    if (this.playing) { this.playing = null; this.emit(); }
  }

  /** Seconds into whatever is playing, or -1. */
  position(): number {
    if (!this.playing || !this.ctx) return -1;
    const t = this.ctx.currentTime - this.startedAt;
    return t <= this.playDur ? t : -1;
  }

  async startMic() {
    const ctx = this.ensure();
    if (this.micOn) return;
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.micNode = ctx.createMediaStreamSource(this.micStream);
    this.micNode.connect(this.analyser!);
    this.tap = ctx.createScriptProcessor(2048, 1, 1);
    this.tap.onaudioprocess = (e) => { if (this.recording) this.recording.push(e.inputBuffer.getChannelData(0).slice()); };
    this.micNode.connect(this.tap);
    this.tap.connect(ctx.destination); // silent: the processor writes no output
    this.micOn = true;
    this.emit();
  }

  stopMic() {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micNode?.disconnect();
    this.tap?.disconnect();
    this.micStream = null; this.micNode = null; this.tap = null;
    this.micOn = false;
    this.emit();
  }

  /** Record from the microphone and make the recording the current clip. */
  async record(seconds: number, onTick?: (t: number) => void) {
    await this.startMic();
    this.recording = [];
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const id = setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        onTick?.(t);
        if (t >= seconds) { clearInterval(id); res(); }
      }, 50);
    });
    const parts = this.recording;
    this.recording = null;
    const len = parts.reduce((a, p) => a + p.length, 0);
    const x = new Float32Array(len);
    let o = 0;
    for (const p of parts) { x.set(p, o); o += p.length; }
    this.setClip({ name: "Your recording", sr: this.sampleRate, channels: [x, x], source: "mic", id: `mic:${Date.now()}` });
  }

  /** Live time-domain snapshot from the analyser. */
  timeData(out: Float32Array<ArrayBuffer>) { this.analyser?.getFloatTimeDomainData(out); return out; }
  freqData(out: Float32Array<ArrayBuffer>) { this.analyser?.getFloatFrequencyData(out); return out; }
  get live() { return this.micOn || this.playing !== null; }
}

export const audio = new AudioEngine();
