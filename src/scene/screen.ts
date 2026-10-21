import * as THREE from "three";
import { C, canvasTexture, part, roundBox } from "./toon";

export type Draw = (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/**
 * A small monitor in the scene. Its face is a canvas texture that lessons draw into
 * (waveforms, spectra, tokens). The same draw function can also paint a full-size 2D
 * canvas, so any screen can be opened large.
 */
export class Screen {
  readonly group = new THREE.Group();
  readonly face: THREE.Mesh;
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  draw: Draw | null = null;
  idle: Draw;
  /** world width/height of the glass */
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number, opts: { stand?: number; px?: number; tilt?: number } = {}) {
    this.w = w; this.h = h;
    const px = opts.px ?? 300;
    const t = canvasTexture(Math.round(w * px), Math.round(h * px));
    this.canvas = t.canvas; this.g = t.g; this.tex = t.tex;
    const bezel = part(roundBox(w + 0.16, 0.12, h + 0.16, 0.08, 0.02), C.navy);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.z = -0.125; // spans z -0.125..-0.005, just behind the glass
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.face.position.z = 0.002;
    const head = new THREE.Group();
    head.add(bezel, this.face);
    head.rotation.x = -(opts.tilt ?? 0.08);
    const standH = opts.stand ?? 0.5;
    head.position.y = standH + h / 2 + 0.08;
    this.group.add(head);
    if (standH > 0) {
      const neck = part(new THREE.BoxGeometry(0.14, standH + 0.1, 0.1), C.navy);
      neck.position.set(0, (standH + 0.1) / 2, -0.14);
      const foot = part(roundBox(Math.min(1.1, w * 0.6), 0.07, 0.5, 0.1, 0.015), C.navy);
      foot.position.set(0, 0, -0.1);
      this.group.add(neck, foot);
    }
    this.idle = (g, W, H) => {
      g.fillStyle = "#1d2742"; g.fillRect(0, 0, W, H);
      g.strokeStyle = "#2c3a5e"; g.lineWidth = 2;
      for (let x = 0; x < W; x += W / 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += H / 7) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    };
    this.paint(0);
  }

  get pixelSize() { return { w: this.canvas.width, h: this.canvas.height }; }

  paint(t: number) {
    const { g, canvas } = this;
    g.save();
    (this.draw ?? this.idle)(g, canvas.width, canvas.height, t);
    g.restore();
    this.tex.needsUpdate = true;
  }

  /** Turn to face the camera's azimuth so the plot reads without skew. */
  face2(yaw: number) { this.group.rotation.y = yaw - (this.group.parent ? this.group.parent.rotation.y : 0); }
}

/** Screen palette: dark glass with paper-coloured ink. */
export const S = {
  bg: "#1d2742",
  grid: "#2c3a5e",
  ink: "#f3ead8",
  dim: "#8f99b3",
  teal: "#3cc6c0",
  orange: "#f4b24f",
  red: "#ef7a5f",
  font: (px: number, w = 600) => `${w} ${px}px "Barlow Semi Condensed", "Barlow", sans-serif`,
  mono: (px: number) => `500 ${px}px "JetBrains Mono", monospace`,
};

export function screenBg(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = S.bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = S.grid;
  g.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  for (let y = 0; y <= h; y += h / 9) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
}

export function screenText(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color = S.ink, align: CanvasTextAlign = "left", mono = false) {
  g.fillStyle = color;
  g.font = mono ? S.mono(px) : S.font(px);
  g.textAlign = align;
  g.textBaseline = "alphabetic";
  g.fillText(text, x, y);
}
