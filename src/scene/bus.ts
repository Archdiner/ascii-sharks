/**
 * Live signal state shared by the scene. The audio engine fills the analyser fields each frame;
 * lessons fill the rest (spectrogram images, codes, flow progress) when they have them.
 */
export const bus = {
  /** 0..1 smoothed loudness of whatever is playing or the mic */
  level: 0,
  live: false,
  time: new Float32Array(2048) as Float32Array<ArrayBuffer>,
  /** analyser magnitudes in dB, 1024 bins over 0..sr/2 */
  spec: new Float32Array(1024) as Float32Array<ArrayBuffer>,
  sr: 48000,
  /** spectrogram of the current clip for the mel printer, 0..1 values, T x F */
  mel: null as Float32Array[] | null,
  /** playhead 0..1 inside the clip, or -1 */
  head: -1,
  /** token codes [codebook][frame] for the token tray */
  codes: null as number[][] | null,
  codeK: 2048,
  /** encoder activations, one image per layer slab */
  enc: [] as HTMLCanvasElement[],
  /** a fixed spectrum (dB, 0..sr/2) for the analyser bars to show when nothing is playing */
  hold: null as Float32Array | null,
  holdSr: 16000,
  /** how many codebook rows of the tray are in use */
  codeRows: 8,
  /** which stations are "lit" by the flow animation, with intensity 0..1 */
  glow: new Map<string, number>(),
  /** wire pulses: station ids whose outgoing wire carries signal */
  flowing: new Set<string>(),
};
