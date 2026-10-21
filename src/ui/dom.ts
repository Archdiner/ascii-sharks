type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") e.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "html") e.innerHTML = String(v);
    else if (k === "class") e.className = String(v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export const PALETTE = {
  bg: "#f6eddd",
  card: "#f9f2e5",
  line: "#cec0ad",
  lineSoft: "#e2d7c7",
  navy: "#18213d",
  navy2: "#24304a",
  ink: "#4f535b",
  muted: "#696d74",
  faint: "#ada293",
  teal: "#1aa3a1",
  tealDeep: "#157f7d",
  tealSoft: "#9fd3cd",
  orange: "#f0a53a",
  rust: "#c0652d",
  red: "#c8553f",
  blue: "#2a56a3",
  trace: "#d3bea3",
  track: "#e3d8ca",
};

export interface Surface {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  dispose: () => void;
}

/** A canvas that tracks its CSS size at device pixel ratio and redraws on resize. */
export function surface(parent: HTMLElement, cls = "viz-canvas", onResize?: () => void): Surface {
  const canvas = el("canvas", { class: cls });
  parent.append(canvas);
  const g = canvas.getContext("2d")!;
  const s: Surface = { canvas, g, w: 0, h: 0, dispose: () => ro.disconnect() };
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    s.w = Math.max(1, r.width);
    s.h = Math.max(1, r.height);
    canvas.width = Math.round(s.w * dpr);
    canvas.height = Math.round(s.h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  fit();
  return s;
}

/** requestAnimationFrame loop; returns a stop function. */
export function loop(fn: (t: number, dt: number) => void) {
  let id = 0, last = performance.now(), alive = true;
  const tick = (t: number) => {
    if (!alive) return;
    fn(t / 1000, Math.min(0.1, (t - last) / 1000));
    last = t;
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => { alive = false; cancelAnimationFrame(id); };
}

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  fmt?: (v: number) => string;
  onInput: (v: number) => void;
}

export function slider(o: SliderOpts) {
  const out = el("output", {}, (o.fmt ?? String)(o.value));
  const input = el("input", { type: "range", min: o.min, max: o.max, step: o.step ?? 1, value: o.value, "aria-label": o.label });
  const paint = () => {
    const p = ((Number(input.value) - o.min) / (o.max - o.min)) * 100;
    input.style.setProperty("--p", `${p}%`);
  };
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = (o.fmt ?? String)(v);
    paint();
    o.onInput(v);
  });
  paint();
  const wrap = el("label", { class: "ctl ctl-slider" }, el("span", { class: "ctl-label" }, o.label), input, out);
  return Object.assign(wrap, {
    set(v: number) { input.value = String(v); out.textContent = (o.fmt ?? String)(v); paint(); },
  });
}

export function segmented<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void) {
  const wrap = el("div", { class: "ctl ctl-seg", role: "group", "aria-label": label }, el("span", { class: "ctl-label" }, label));
  const btns = options.map(([v, text]) => {
    const b = el("button", { type: "button", class: v === value ? "is-on" : "", "aria-pressed": String(v === value) }, text);
    b.addEventListener("click", () => {
      btns.forEach((x) => { x.classList.remove("is-on"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("is-on");
      b.setAttribute("aria-pressed", "true");
      onChange(v);
    });
    return b;
  });
  const row = el("div", { class: "seg" }, ...btns);
  wrap.append(row);
  return wrap;
}

export function toggle(label: string, on: boolean, onChange: (v: boolean) => void, hint?: string) {
  const b = el("button", { type: "button", class: `chip-toggle${on ? " is-on" : ""}`, "aria-pressed": String(on), title: hint }, el("span", { class: "dot" }), label);
  b.addEventListener("click", () => {
    on = !on;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
    onChange(on);
  });
  return b;
}

export function button(label: string, onClick: () => void, cls = "btn") {
  return el("button", { type: "button", class: cls, onclick: onClick as EventListener }, label);
}

export function controls(...items: Child[]) {
  return el("div", { class: "controls" }, ...items);
}

// Spectrogram colour ramp: paper → sand → teal → navy, with an amber tip for the loudest bins.
const STOPS: [number, [number, number, number]][] = [
  [0, [249, 242, 229]],
  [0.25, [226, 210, 186]],
  [0.5, [100, 184, 176]],
  [0.72, [26, 120, 128]],
  [0.9, [24, 33, 61]],
  [1, [240, 165, 58]],
];
export const RAMP: Uint8ClampedArray = (() => {
  const r = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
    const [t0, c0] = STOPS[j], [t1, c1] = STOPS[j + 1];
    const u = (t - t0) / (t1 - t0);
    for (let k = 0; k < 3; k++) r[i * 3 + k] = c0[k] + (c1[k] - c0[k]) * u;
  }
  return r;
})();

/**
 * Paint a T x F matrix (values already in 0..1) as an image, time left→right, low freq at bottom.
 * rowMap maps an output pixel row (0 = top) to a fractional source row, for log / mel axes.
 */
export function heatmap(data: ArrayLike<number>[], rowsOut = 160, rowMap?: (y: number, rows: number) => number): HTMLCanvasElement {
  const T = Math.max(1, data.length), F = data[0]?.length ?? 1;
  const c = document.createElement("canvas");
  c.width = T;
  c.height = rowsOut;
  const g = c.getContext("2d")!;
  const img = g.createImageData(T, rowsOut);
  for (let y = 0; y < rowsOut; y++) {
    const src = rowMap ? rowMap(y, rowsOut) : ((rowsOut - 1 - y) / (rowsOut - 1)) * (F - 1);
    const f0 = Math.max(0, Math.min(F - 1, Math.floor(src)));
    if (src < 0) {
      // outside the signal's band: hatched void, so the missing region reads as missing
      for (let t = 0; t < T; t++) {
        const o = (y * T + t) * 4;
        const hatch = (t + y) % 6 < 1 ? 214 : 236;
        img.data[o] = hatch; img.data[o + 1] = hatch - 10; img.data[o + 2] = hatch - 26; img.data[o + 3] = 255;
      }
      continue;
    }
    for (let t = 0; t < T; t++) {
      const v = Math.max(0, Math.min(1, data[t][f0] ?? 0));
      const ci = Math.round(v * 255) * 3;
      const o = (y * T + t) * 4;
      img.data[o] = RAMP[ci]; img.data[o + 1] = RAMP[ci + 1]; img.data[o + 2] = RAMP[ci + 2]; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function rampColor(v: number) {
  const i = Math.round(Math.max(0, Math.min(1, v)) * 255) * 3;
  return `rgb(${RAMP[i]},${RAMP[i + 1]},${RAMP[i + 2]})`;
}

/** Draw a waveform polyline of x[from..to] into a box. */
export function wave(g: CanvasRenderingContext2D, x: ArrayLike<number>, bx: number, by: number, bw: number, bh: number, color: string, lw = 1.5, from = 0, to = x.length, gain = 1) {
  const n = to - from;
  g.beginPath();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineJoin = "round";
  if (n > bw * 2) {
    // min/max per pixel column for dense signals
    for (let px = 0; px < bw; px++) {
      const a = from + Math.floor((px / bw) * n), b = from + Math.floor(((px + 1) / bw) * n);
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < Math.max(a + 1, b); i++) { const v = x[i] ?? 0; if (v < lo) lo = v; if (v > hi) hi = v; }
      g.moveTo(bx + px + 0.5, by + bh / 2 - hi * gain * (bh / 2));
      g.lineTo(bx + px + 0.5, by + bh / 2 - lo * gain * (bh / 2) + 0.5);
    }
  } else {
    for (let i = 0; i < n; i++) {
      const px = bx + (i / Math.max(1, n - 1)) * bw;
      const py = by + bh / 2 - (x[from + i] ?? 0) * gain * (bh / 2);
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
  }
  g.stroke();
}

export function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, opts: { color?: string; size?: number; align?: CanvasTextAlign; weight?: number; mono?: boolean; base?: CanvasTextBaseline } = {}) {
  g.fillStyle = opts.color ?? PALETTE.muted;
  g.font = `${opts.weight ?? 600} ${opts.size ?? 11}px ${opts.mono ? '"JetBrains Mono", monospace' : '"Barlow Semi Condensed", "Barlow", sans-serif'}`;
  g.textAlign = opts.align ?? "left";
  g.textBaseline = opts.base ?? "alphabetic";
  g.fillText(text, x, y);
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export function fmtHz(f: number) {
  return f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`;
}

export function fmtBits(bps: number) {
  if (!isFinite(bps)) return "∞";
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} Mb/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(bps >= 1e4 ? 0 : 1)} kb/s`;
  return `${Math.round(bps)} b/s`;
}

/** Let the browser paint (e.g. a "computing…" log line) before heavy synchronous work. */
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
