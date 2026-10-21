import * as THREE from "three";
import { C, part, roundBox, toon, toonLive, decal, edges, hull, canvasTexture } from "./toon";
import { Screen } from "./screen";
import { bus } from "./bus";
import { DEFAULTS } from "./defaults";
import type { Station, World } from "./world";

/** Where each station sits on the floor. Row A runs left→right, the encoder turns the corner, row B runs back. */
export const LAYOUT: Record<string, [number, number]> = {
  source: [-13.5, -4.2],
  mic: [-8.1, -4.2],
  adc: [-2.7, -4.2],
  fft: [2.7, -4.2],
  mel: [8.1, -4.2],
  encoder: [13.4, 0],
  tokens: [8.1, 4.2],
  projector: [2.7, 4.2],
  lm: [-2.7, 4.2],
  head: [-8.1, 4.2],
  voice: [-13.5, 4.2],
};

export const ORDER = ["source", "mic", "adc", "fft", "mel", "encoder", "tokens", "projector", "lm", "head", "voice"];

const pick = (o: THREE.Object3D, name: string) => { o.userData.part = name; return o; };
const anchor = (x: number, y: number, z: number) => { const o = new THREE.Object3D(); o.position.set(x, y, z); return o; };

function pedestal(num: number, title: string, w = 3.6, d = 3.6) {
  const g = new THREE.Group();
  const base = part(roundBox(w, 0.3, d, 0.22, 0.04), C.cream);
  g.add(base);
  // breadboard-style dot field on top
  const { g: c, tex } = canvasTexture(256, 256);
  c.fillStyle = "#e9dcc6";
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.beginPath(); c.arc(8 + x * 16, 8 + y * 16, 2.2, 0, 7); c.fill(); }
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 1.6, d / 1.6);
  const dots = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, d - 0.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false }));
  dots.rotation.x = -Math.PI / 2;
  dots.position.y = 0.302;
  g.add(dots);
  // number plate on the front edge
  const plate = decal(`${String(num).padStart(2, "0")} · ${title.toUpperCase()}`, 2.4, 0.2, { color: "#24304a", weight: "700" });
  plate.rotation.x = 0;
  plate.position.set(0, 0.15, d / 2 + 0.046); // just proud of the bevel
  g.add(plate);
  return g;
}

function monitor(s: Station, w: number, h: number, x: number, z: number, stand: number, key = "main") {
  const scr = new Screen(w, h, { stand });
  scr.group.position.set(x, 0.3, z);
  s.group.add(scr.group);
  s.screens[key] = scr;
  const a = anchor(x, 0.3 + stand + h + 0.12, z);
  s.group.add(a);
  s.anchors.screen = a;
  return scr;
}

function station(id: string, name: string, num: number): Station {
  const group = new THREE.Group();
  const [x, z] = LAYOUT[id];
  group.position.set(x, 0, z);
  group.add(pedestal(num, name));
  return { id, name, group, anchors: {}, screens: {}, pick: [] };
}

// ---------------------------------------------------------------- speakers

function speakerCabinet(scale = 1) {
  const g = new THREE.Group();
  const box = part(roundBox(1.1 * scale, 1.9 * scale, 1.3 * scale, 0.1 * scale, 0.03), C.wood);
  g.add(box);
  const cones: THREE.Group[] = [];
  const face = 0.55 * scale + 0.01;
  for (const [cy, r] of [[1.25 * scale, 0.42 * scale], [0.55 * scale, 0.22 * scale]] as const) {
    const cone = new THREE.Group();
    const surround = part(new THREE.TorusGeometry(r, r * 0.12, 10, 32), C.black, "hull");
    const paper = part(new THREE.ConeGeometry(r * 0.95, r * 0.5, 32, 1, true), C.navy, "none");
    paper.rotation.x = Math.PI / 2;
    paper.position.z = -r * 0.1;
    (paper.material as THREE.Material).side = THREE.DoubleSide;
    const cap = part(new THREE.SphereGeometry(r * 0.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), C.ink, "hull");
    cap.rotation.x = Math.PI / 2;
    cone.add(surround, paper, cap);
    cone.rotation.y = Math.PI / 2;
    cone.position.set(face, cy, 0);
    g.add(cone);
    cones.push(cone);
  }
  return { g, cones };
}

function airRings(count = 6, color = C.teal) {
  const rings: THREE.Mesh[] = [];
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.025, 6, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
    m.rotation.y = Math.PI / 2;
    g.add(m);
    rings.push(m);
  }
  return { g, rings };
}

export function buildSource(): Station {
  const s = station("source", "Source", 1);
  const { g, cones } = speakerCabinet();
  g.position.set(-0.6, 0.3, 0);
  s.group.add(g);
  const air = airRings();
  air.g.position.set(-0.05 + 0.01, 0.3 + 1.25, 0);
  s.group.add(air.g);
  pick(g, "speaker");
  s.pick.push(g);
  s.anchors.cone = anchor(0.0, 1.6, 0);
  s.anchors.cabinet = anchor(-0.6, 2.25, 0);
  s.anchors.air = anchor(1.25, 1.55, 0);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  let phase = 0;
  monitor(s, 1.7, 1.05, 0.95, -1.15, 0.55);
  s.update = (_t, dt) => {
    const lv = bus.live ? bus.level : 0;
    cones[0].position.x = 0.56 + Math.sin(_t * 60) * 0.02 * lv;
    phase += dt * (0.6 + lv * 0.8);
    air.rings.forEach((r, i) => {
      const u = (phase + i / air.rings.length) % 1;
      r.position.x = 0.6 + u * 2.1;
      r.scale.setScalar(0.7 + u * 1.6);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - u) * Math.min(1, lv * 3) * 0.8;
    });
  };
  return s;
}

export function buildVoice(): Station {
  const s = station("voice", "Model voice", 11);
  const { g, cones } = speakerCabinet(0.8);
  g.rotation.y = -Math.PI / 2; // cones point at +z, toward the viewer
  g.position.set(0, 0.3, -0.5);
  s.group.add(g);
  const air = airRings(5, C.orange);
  air.g.rotation.y = -Math.PI / 2;
  air.g.position.set(0, 0.3 + 1.0, -0.05);
  s.group.add(air.g);
  s.anchors.cone = anchor(0, 1.3, 0.05);
  s.group.add(s.anchors.cone);
  s.update = (t, dt) => {
    const lv = bus.glow.get("voice") ?? 0;
    cones[0].position.x = 0.45 + Math.sin(t * 50) * 0.015 * lv;
    air.rings.forEach((r, i) => {
      const u = (t * 0.7 + i / air.rings.length) % 1;
      r.position.x = 0.45 + u * 1.3;
      r.scale.setScalar(0.6 + u * 1.3);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - u) * lv * 0.8;
    });
    void dt;
  };
  return s;
}

// ---------------------------------------------------------------- microphone

export function buildMic(): Station {
  const s = station("mic", "Microphone", 2);
  const g = new THREE.Group();
  g.position.y = 0.3;
  const foot = part(new THREE.CylinderGeometry(0.6, 0.66, 0.1, 32), C.navy, "both");
  foot.position.y = 0.05;
  const pole = part(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 12), C.metalDark, "hull");
  pole.position.y = 0.85;
  const clip = part(new THREE.BoxGeometry(0.16, 0.22, 0.16), C.navy);
  clip.position.y = 1.62;
  const head = new THREE.Group();
  head.position.y = 1.7;
  head.rotation.z = Math.PI / 2 - 0.35; // point at the source (−x)
  const body = part(new THREE.CylinderGeometry(0.2, 0.15, 0.95, 28), C.navy, "hull");
  body.position.y = 0.45;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.035, 8, 32), toonLive(C.teal, 0x000000));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.95;
  const grille = part(new THREE.SphereGeometry(0.33, 14, 10), C.metal, "none");
  grille.position.y = 1.18;
  edges(grille, 1, 1.1, C.metalDark);
  hull(grille);
  head.add(body, ring, grille);
  g.add(foot, pole, clip, head);
  s.group.add(g);
  pick(g, "mic");
  s.pick.push(g);
  // cable to the ADC
  s.anchors.grille = new THREE.Object3D();
  grille.add(s.anchors.grille);
  s.anchors.ring = new THREE.Object3D();
  ring.add(s.anchors.ring);
  s.anchors.stand = anchor(0, 0.5, 0.5);
  s.group.add(s.anchors.stand);
  const scr = new Screen(1.7, 1.05, { stand: 0.2 });
  scr.group.position.set(0.95, 0.3, -1.1);
  s.group.add(scr.group);
  s.screens.main = scr;
  s.anchors.screen = anchor(0.95, 1.67, -1.1);
  s.group.add(s.anchors.screen);
  const ringMat = ring.material as THREE.MeshToonMaterial;
  s.update = () => {
    const lv = bus.live ? bus.level : 0;
    ringMat.emissive.setRGB(0.1 * lv * 3, 0.64 * lv * 1.5, 0.63 * lv * 1.5);
    head.rotation.x = Math.sin(performance.now() / 900) * 0.01;
  };
  return s;
}

// ---------------------------------------------------------------- ADC board

function chip(w: number, d: number, pins = 6) {
  const g = new THREE.Group();
  const body = part(roundBox(w, 0.16, d, 0.04, 0.015), C.chip);
  g.add(body);
  const pinGeo = new THREE.BoxGeometry(0.05, 0.04, 0.12);
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < pins; i++) {
      const p = new THREE.Mesh(pinGeo, toon(C.metal));
      const along = -((pins - 1) / 2) * 0.13 + i * 0.13;
      const len = side % 2 === 0 ? d : w;
      p.position.y = 0.03;
      if (side === 0) p.position.set(along, 0.03, len / 2 + 0.05);
      if (side === 1) { p.position.set(w / 2 + 0.05, 0.03, along); p.rotation.y = Math.PI / 2; }
      if (side === 2) p.position.set(along, 0.03, -len / 2 - 0.05);
      if (side === 3) { p.position.set(-w / 2 - 0.05, 0.03, along); p.rotation.y = Math.PI / 2; }
      g.add(p);
    }
  }
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), new THREE.MeshBasicMaterial({ color: 0x5a6070 }));
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(-w / 2 + 0.12, 0.162, -d / 2 + 0.12);
  g.add(dot);
  return g;
}

export function buildAdc(): Station {
  const s = station("adc", "ADC", 3);
  const pcb = part(roundBox(2.6, 0.1, 1.8, 0.1, 0.02), C.pcb);
  pcb.position.set(0, 0.3, 0.35);
  s.group.add(pcb);
  const silk = decal("ANALOG → DIGITAL", 1.6, 0.16, { color: "#c9d3ee" });
  silk.position.set(0.25, 0.41, 1.1);
  s.group.add(silk);
  const ic = chip(0.8, 0.8);
  ic.position.set(0.15, 0.4, 0.3);
  const lab = decal("ADC", 0.5, 0.2, { color: "#c4c8d2" });
  lab.position.set(0.15, 0.565, 0.32);
  s.group.add(ic, lab);
  pick(ic, "chip");
  s.pick.push(ic);
  // crystal: the sample clock
  const xtal = part(new THREE.CapsuleGeometry(0.11, 0.32, 6, 16), C.metal, "hull");
  xtal.rotation.z = Math.PI / 2;
  xtal.position.set(-0.75, 0.52, 0.65);
  pick(xtal, "clock");
  s.pick.push(xtal);
  // input jack
  const jack = part(new THREE.BoxGeometry(0.42, 0.34, 0.42), C.black);
  jack.position.set(-1.05, 0.57, 0.0);
  const hole = part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), C.metalDark, "hull");
  hole.rotation.z = Math.PI / 2;
  hole.position.set(-1.27, 0.6, 0.0);
  // header pins and caps for detail
  for (let i = 0; i < 6; i++) {
    const pin = part(new THREE.BoxGeometry(0.08, 0.28, 0.08), C.black, "none");
    pin.position.set(0.85, 0.48, -0.25 + i * 0.16);
    s.group.add(pin);
  }
  for (const [cx, cz] of [[0.95, 0.85], [0.7, 0.95]]) {
    const cap = part(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 16), C.teal, "hull");
    cap.position.set(cx, 0.53, cz);
    s.group.add(cap);
  }
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.08), toonLive(C.red, 0x000000));
  led.position.set(-0.6, 0.43, 1.05);
  s.group.add(xtal, jack, hole, led);
  const scr = new Screen(2.9, 1.7, { stand: 0.35 });
  scr.group.position.set(0, 0.3, -1.15);
  s.group.add(scr.group);
  s.screens.main = scr;
  s.anchors.chip = anchor(0.15, 0.52, 0.3);
  s.anchors.clock = anchor(-0.75, 0.52, 0.65);
  s.anchors.input = anchor(-1.1, 0.75, 0);
  s.anchors.screen = anchor(0, 2.5, -1.15);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  const ledMat = led.material as THREE.MeshToonMaterial;
  s.update = (t) => {
    const on = bus.live && Math.sin(t * 30) > 0;
    ledMat.emissive.setHex(on ? 0x8a2010 : 0x000000);
  };
  return s;
}

// ---------------------------------------------------------------- spectrum analyser

export function buildFft(): Station {
  const s = station("fft", "Spectrum", 4);
  const deck = part(roundBox(2.7, 0.18, 1.3, 0.1, 0.02), C.navy);
  deck.position.set(0, 0.3, 0.65);
  s.group.add(deck);
  const N = 24;
  const bars: THREE.Mesh[] = [];
  const geo = new THREE.BoxGeometry(0.075, 1, 0.5);
  geo.translate(0, 0.5, 0);
  for (let i = 0; i < N; i++) {
    const m = part(geo, toonLive(C.teal), "edges");
    m.position.set(-1.2 + (i / (N - 1)) * 2.4, 0.48, 0.65);
    m.scale.y = 0.05;
    s.group.add(m);
    bars.push(m);
  }
  pick(deck, "bars");
  s.pick.push(deck, ...bars.map((b) => pick(b, "bars")));
  const scr = new Screen(2.9, 1.6, { stand: 0.35 });
  scr.group.position.set(0, 0.3, -1.05);
  s.group.add(scr.group);
  s.screens.main = scr;
  s.anchors.bars = anchor(-0.4, 1.3, 0.65);
  s.anchors.low = anchor(-1.2, 0.9, 0.65);
  s.anchors.high = anchor(1.2, 0.9, 0.65);
  s.anchors.screen = anchor(0, 2.4, -1.05);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  const smooth = new Float32Array(N);
  s.update = () => {
    // log-spaced bands from 60 Hz to 16 kHz, read from the analyser (or a held frame)
    for (let i = 0; i < N; i++) {
      let v = 0;
      const src = bus.live ? bus.spec : bus.hold;
      if (src) {
        const nb = src.length;
        const f0 = 60 * Math.pow(16000 / 60, i / N), f1 = 60 * Math.pow(16000 / 60, (i + 1) / N);
        const sr = bus.live ? bus.sr : bus.holdSr;
        const a = Math.floor((f0 / (sr / 2)) * nb), b = Math.max(a + 1, Math.floor((f1 / (sr / 2)) * nb));
        let mx = -140;
        for (let k = a; k < b && k < nb; k++) mx = Math.max(mx, src[k]);
        v = Math.max(0, (mx + 95) / 70);
      }
      smooth[i] += (v - smooth[i]) * 0.3;
      const h = 0.04 + smooth[i] * 1.5;
      bars[i].scale.y = h;
      const mat = bars[i].material as THREE.MeshToonMaterial;
      mat.color.setHex(smooth[i] > 0.75 ? C.orange : C.teal);
    }
  };
  return s;
}

// ---------------------------------------------------------------- mel printer

export function buildMel(): Station {
  const s = station("mel", "Mel printer", 5);
  const body = part(roundBox(2.3, 0.75, 1.4, 0.18, 0.04), C.paper);
  body.position.set(0, 0.3, 0.2);
  const lid = part(roundBox(2.0, 0.08, 1.0, 0.12, 0.02), C.navy);
  lid.position.set(0, 1.05, 0.05);
  const slot = part(new THREE.BoxGeometry(1.7, 0.04, 0.08), C.ink, "none");
  slot.position.set(0, 1.06, 0.62);
  s.group.add(body, lid, slot);
  // the dial sets how many mel bands get printed
  const knob = part(new THREE.CylinderGeometry(0.17, 0.19, 0.14, 24), C.orange, "both");
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.75, 0.72, 0.92);
  const tick = part(new THREE.BoxGeometry(0.04, 0.12, 0.03), C.ink, "none");
  tick.position.set(0, 0.07, 0.08);
  knob.add(tick);
  pick(knob, "knob");
  s.pick.push(knob);
  s.group.add(knob);
  const ledG = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.05), toonLive(C.teal));
  ledG.position.set(-0.85, 0.75, 0.92);
  s.group.add(ledG);
  // paper: a strip that leaves the slot and curls toward the viewer
  const W = 1.6, L = 2.2;
  const pgeo = new THREE.PlaneGeometry(W, L, 1, 40);
  const pos = pgeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = (pos.getY(i) + L / 2) / L; // 0 at slot, 1 at free end
    const ang = v * 1.9;
    const r = 0.9;
    pos.setXYZ(i, pos.getX(i), 1.08 + Math.sin(ang) * r * 0.9, 0.62 + (1 - Math.cos(ang)) * r * 0.9 + v * 0.15);
  }
  pgeo.computeVertexNormals();
  const { canvas: pc, g: pg, tex } = canvasTexture(256, 512);
  const paper = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  paper.castShadow = true;
  edges(paper, 20, 1.3);
  s.group.add(paper);
  pick(paper, "paper");
  s.pick.push(paper);
  s.anchors.paper = anchor(0, 1.75, 1.35);
  monitor(s, 2.4, 1.4, -0.15, -1.25, 1.0);
  s.anchors.knob = anchor(0.75, 0.72, 1.0);
  s.anchors.slot = anchor(-0.5, 1.1, 0.6);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  let lastMel: Float32Array[] | null = null;
  let lastHead = -2;
  s.update = () => {
    const mel = bus.mel;
    const head = bus.head;
    if (mel === lastMel && Math.abs(head - lastHead) < 0.004) return;
    lastMel = mel; lastHead = head;
    pg.fillStyle = "#fbf6ec";
    pg.fillRect(0, 0, pc.width, pc.height);
    if (!mel || !mel.length) return void (tex.needsUpdate = true);
    // printed so time runs along the paper (top = earliest), low frequencies on the left
    const T = mel.length, F = mel[0].length;
    const img = pg.createImageData(pc.width, pc.height);
    const upto = head >= 0 ? Math.floor(head * T) : T;
    for (let y = 0; y < pc.height; y++) {
      const t = Math.floor((y / pc.height) * T);
      for (let x = 0; x < pc.width; x++) {
        const f = Math.floor((x / pc.width) * F);
        const o = (y * pc.width + x) * 4;
        const v = t < upto ? Math.max(0, Math.min(1, mel[t][f])) : 0;
        // ink ramp: paper → teal → navy
        const r = 251 + (v < 0.5 ? (26 - 251) * v * 2 : (26 - 251) + (24 - 26) * (v - 0.5) * 2);
        const gg = 246 + (v < 0.5 ? (163 - 246) * v * 2 : (163 - 246) + (33 - 163) * (v - 0.5) * 2);
        const b = 236 + (v < 0.5 ? (161 - 236) * v * 2 : (161 - 236) + (61 - 161) * (v - 0.5) * 2);
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    pg.putImageData(img, 0, 0);
    tex.needsUpdate = true;
  };
  return s;
}

// ---------------------------------------------------------------- encoder stack

export function buildEncoder(): Station {
  const s = station("encoder", "Encoder", 6);
  const plates: THREE.Mesh[] = [];
  const tops: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; c: HTMLCanvasElement }[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const conv = i < 2;
    const m = part(roundBox(1.9, 0.16, 1.9, 0.12, 0.02), conv ? toonLive(C.pcb) : toonLive(C.tealLight), "edges");
    m.position.set(0.45, 0.45 + i * 0.5, 0.45);
    if (!conv) { (m.material as THREE.MeshToonMaterial).transparent = true; (m.material as THREE.MeshToonMaterial).opacity = 0.85; }
    s.group.add(m);
    plates.push(m);
    const { canvas: c, g, tex } = canvasTexture(128, 128);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 1.65), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.165;
    m.add(top);
    tops.push({ mesh: top, tex, g, c });
    pick(m, i < 2 ? "conv" : "layers");
    s.pick.push(m);
  }
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = part(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 10), C.metalDark, "hull");
    post.position.set(0.45 + px * 0.84, 1.4, 0.45 + pz * 0.84);
    s.group.add(post);
  }
  const cap = part(roundBox(1.2, 0.1, 0.5, 0.08, 0.02), C.navy);
  cap.position.set(0.45, 2.65, 0.45);
  const capLab = decal("× 32 LAYERS", 1.0, 0.24, { color: "#f3ead8" });
  capLab.position.set(0.45, 2.756, 0.45);
  s.group.add(cap, capLab);
  s.anchors.conv = anchor(-0.45, 0.75, 1.3);
  s.anchors.layers = anchor(-0.45, 2.0, 1.3);
  s.anchors.top = anchor(0.45, 2.8, 0.45);
  s.anchors.input = anchor(0.45, 0.5, -0.5);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  let lastEnc: HTMLCanvasElement[] = [];
  monitor(s, 1.9, 1.2, -1.0, -1.1, 1.2);
  s.update = (t) => {
    const glow = bus.glow.get("encoder") ?? 0;
    plates.forEach((p, i) => {
      const k = Math.max(0, Math.sin(t * 4 - i * 0.9)) * glow;
      (p.material as THREE.MeshToonMaterial).emissive.setRGB(0.05 * k, 0.3 * k, 0.3 * k);
    });
    if (bus.enc !== lastEnc) {
      lastEnc = bus.enc;
      tops.forEach((tp, i) => {
        const src = bus.enc[Math.min(i, bus.enc.length - 1)];
        tp.g.clearRect(0, 0, tp.c.width, tp.c.height);
        if (src) { tp.g.imageSmoothingEnabled = false; tp.g.drawImage(src, 0, 0, tp.c.width, tp.c.height); }
        tp.tex.needsUpdate = true;
      });
    }
  };
  return s;
}

// ---------------------------------------------------------------- token tray

export function buildTokens(): Station {
  const s = station("tokens", "Tokens", 7);
  const tray = part(roundBox(2.8, 0.22, 2.0, 0.14, 0.03), C.wood);
  tray.position.set(0, 0.3, 0.45);
  s.group.add(tray);
  const ROWS = 8, COLS = 10;
  const tileGeo = roundBox(0.22, 0.12, 0.17, 0.04, 0.012);
  const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: (tray.material as THREE.MeshToonMaterial).gradientMap });
  const inst = new THREE.InstancedMesh(tileGeo, mat, ROWS * COLS);
  inst.castShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const heights = new Float32Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    dummy.position.set(-1.15 + c * 0.255, 0.53, -0.37 + r * 0.205);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, col.setHex(0xe8dcc7));
  }
  s.group.add(inst);
  // printed numbers on top of the tiles
  const { canvas: nc, g: ng, tex: ntex } = canvasTexture(640, 512);
  const numbers = new THREE.Mesh(new THREE.PlaneGeometry(2.55, 1.64), new THREE.MeshBasicMaterial({ map: ntex, transparent: true, depthWrite: false }));
  numbers.rotation.x = -Math.PI / 2;
  numbers.position.set(-0.005, 0.652, 0.35);
  s.group.add(numbers);
  pick(tray, "tray");
  s.pick.push(tray);
  s.anchors.row0 = anchor(-1.3, 0.7, -0.37);
  s.anchors.tiles = anchor(0.6, 0.75, 0.75);
  s.anchors.column = anchor(-0.12, 0.75, 1.1);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  let last: number[][] | null = null;
  monitor(s, 2.7, 1.05, 0.0, -1.3, 0.35);

  let lastOff = -1;
  let rowsSeen = 8;
  s.update = (t, dt) => {
    const codes = bus.codes;
    const T = codes?.[0]?.length ?? 0;
    const off = T > COLS && bus.head >= 0 ? Math.max(0, Math.min(T - COLS, Math.floor(bus.head * T) - COLS + 2)) : 0;
    if (codes !== last || off !== lastOff || rowsSeen !== bus.codeRows) {
      last = codes; lastOff = off; rowsSeen = bus.codeRows;
      ng.clearRect(0, 0, nc.width, nc.height);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const v = codes?.[r]?.[c + off];
        if (v === undefined || r >= bus.codeRows) { inst.setColorAt(i, col.setHex(0xe8dcc7)); continue; }
        const hue = r === 0 ? 0.08 + ((v * 0.618) % 1) * 0.06 : 0.47 + ((v * 0.618) % 1) * 0.12;
        inst.setColorAt(i, col.setHSL(hue, r === 0 ? 0.75 : 0.45, 0.42 + ((v * 0.37) % 1) * 0.25));
        heights[i] = 0.12;
        ng.fillStyle = "#fffaf2";
        ng.font = '600 26px "JetBrains Mono", monospace';
        ng.textAlign = "center";
        ng.textBaseline = "middle";
        ng.fillText(String(v), (c + 0.5) * (nc.width / COLS), (r + 0.5) * (nc.height / ROWS));
      }
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      ntex.needsUpdate = true;
    }
    // tiles hop a little when new codes land
    for (let i = 0; i < ROWS * COLS; i++) {
      if (heights[i] <= 0) continue;
      heights[i] = Math.max(0, heights[i] - dt * 0.6);
      const r = Math.floor(i / COLS), c = i % COLS;
      dummy.position.set(-1.15 + c * 0.255, 0.53 + heights[i], -0.37 + r * 0.205);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    numbers.position.y = 0.652;
    void t;
  };
  return s;
}

// ---------------------------------------------------------------- projector

export function buildProjector(): Station {
  const s = station("projector", "Projector", 8);
  const inLane = part(roundBox(0.6, 0.35, 0.9, 0.06, 0.02), C.tealLight);
  inLane.position.set(1.0, 0.3, 0.35);
  const funnelGeo = new THREE.CylinderGeometry(0.75, 0.32, 1.3, 4, 1);
  funnelGeo.rotateY(Math.PI / 4);
  funnelGeo.rotateZ(Math.PI / 2);
  const funnel = part(funnelGeo, toonLive(C.teal), "edges", 20);
  funnel.position.set(0.05, 0.95, 0.35);
  (funnel.material as THREE.MeshToonMaterial).transparent = true;
  (funnel.material as THREE.MeshToonMaterial).opacity = 0.9;
  const mlpLab = decal("MLP", 0.6, 0.24, { color: "#f3ead8" });
  mlpLab.rotation.x = 0; mlpLab.position.set(0.05, 0.95, 1.12);
  const outs: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const o = part(roundBox(0.32, 1.25, 1.45, 0.06, 0.02), toonLive(C.navy));
    o.position.set(-0.75 - i * 0.42, 0.3, 0.35);
    outs.push(o);
    s.group.add(o);
  }
  s.group.add(inLane, funnel, mlpLab);
  pick(funnel, "mlp");
  s.pick.push(funnel);
  s.anchors.in = anchor(1.0, 0.75, 0.65);
  s.anchors.mlp = anchor(0.05, 1.5, 0.35);
  s.anchors.out = anchor(-1.2, 1.6, 0.75);
  monitor(s, 2.1, 1.2, 0.2, -1.3, 1.0);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  s.update = (t) => {
    const glow = bus.glow.get("projector") ?? 0;
    outs.forEach((o, i) => {
      const k = Math.max(0, Math.sin(t * 5 - i)) * glow;
      (o.material as THREE.MeshToonMaterial).emissive.setRGB(0.05 * k, 0.35 * k, 0.33 * k);
    });
  };
  return s;
}

// ---------------------------------------------------------------- language model tower

export function buildLm(): Station {
  const s = station("lm", "Language model", 9);
  const n = 9;
  const slabs: THREE.Mesh[] = [];
  for (let i = 0; i < n; i++) {
    const m = part(roundBox(1.75, 0.22, 1.75, 0.16, 0.03), toonLive(i % 2 ? C.navy : C.pcb));
    m.position.set(0.45, 0.32 + i * 0.3, 0.45);
    slabs.push(m);
    s.group.add(m);
    pick(m, "layers");
    s.pick.push(m);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, n * 0.3 + 0.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: C.teal, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  core.position.set(0.45, 0.3 + (n * 0.3) / 2, 0.45);
  s.group.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 8, 48), new THREE.MeshBasicMaterial({ color: C.orange }));
  ring.rotation.x = Math.PI / 2;
  ring.position.x = 0.45; ring.position.z = 0.45;
  s.group.add(ring);
  const cap = part(roundBox(1.4, 0.12, 0.5, 0.08, 0.02), C.ink);
  cap.position.set(0.45, 0.32 + n * 0.3 + 0.02, 0.45);
  const capLab = decal("7B · 28 LAYERS", 1.2, 0.24, { color: "#f3ead8" });
  capLab.position.set(0.45, cap.position.y + 0.13, 0.45);
  s.group.add(cap, capLab);
  s.anchors.base = anchor(1.3, 0.6, 1.3);
  s.anchors.mid = anchor(1.3, 1.7, 1.3);
  s.anchors.top = anchor(0.45, 3.2, 0.45);
  s.anchors.ring = anchor(-0.75, 1.5, 0.45);
  monitor(s, 1.9, 1.2, -1.0, -1.1, 1.45);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  s.update = (t) => {
    const glow = bus.glow.get("lm") ?? 0;
    const u = (t * 0.45) % 1;
    ring.position.y = 0.4 + u * (n * 0.3);
    (ring.material as THREE.MeshBasicMaterial).opacity = glow;
    (ring.material as THREE.MeshBasicMaterial).transparent = true;
    ring.visible = glow > 0.02;
    slabs.forEach((sl, i) => {
      const d = Math.abs(i / (n - 1) - u);
      const k = Math.max(0, 1 - d * 5) * glow;
      (sl.material as THREE.MeshToonMaterial).emissive.setRGB(0.25 * k, 0.17 * k, 0.04 * k);
    });
  };
  return s;
}

// ---------------------------------------------------------------- output head

export function buildHead(): Station {
  const s = station("head", "LM head", 10);
  const scr = new Screen(3.1, 1.85, { stand: 0.35 });
  scr.group.position.set(0, 0.3, -0.45);
  s.group.add(scr.group);
  s.screens.main = scr;
  const kb = part(roundBox(1.8, 0.1, 0.55, 0.06, 0.02), C.paper);
  kb.position.set(0, 0.3, 0.95);
  s.group.add(kb);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) {
    const key = part(new THREE.BoxGeometry(0.12, 0.05, 0.11), C.sand, "none");
    key.position.set(-0.75 + c * 0.165, 0.42, 0.78 + r * 0.15);
    s.group.add(key);
  }
  s.anchors.screen = anchor(0, 2.65, -0.45);
  s.anchors.bars = anchor(-0.7, 1.2, -0.3);
  Object.values(s.anchors).forEach((a) => s.group.add(a));
  return s;
}

// ---------------------------------------------------------------- wires between stations

export interface Wire { from: string; to: string; curve: THREE.CatmullRomCurve3; pulses: THREE.Mesh[] }

export function buildWires(world: World): Wire[] {
  const wires: Wire[] = [];
  const colors = [C.black, C.orange, C.orange, C.teal, C.teal, C.navy, C.navy, C.orange, C.orange, C.teal];
  const pulseGeo = new THREE.SphereGeometry(0.09, 12, 8);
  for (let i = 0; i < ORDER.length - 1; i++) {
    const a = ORDER[i], b = ORDER[i + 1];
    const [ax, az] = LAYOUT[a], [bx, bz] = LAYOUT[b];
    const pa = new THREE.Vector3(ax, 0.32, az), pb = new THREE.Vector3(bx, 0.32, bz);
    // leave the pedestal on the side facing the next station
    const d = pb.clone().sub(pa).setY(0).normalize();
    const p0 = pa.clone().addScaledVector(d, 1.75).setY(0.2);
    const p3 = pb.clone().addScaledVector(d, -1.75).setY(0.2);
    const mid = p0.clone().lerp(p3, 0.5);
    const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(0.25 * (i % 2 ? 1 : -1));
    const curve = new THREE.CatmullRomCurve3([
      p0, p0.clone().lerp(p3, 0.25).add(side).setY(0.08), mid.clone().add(side).setY(0.06), p3.clone().lerp(p0, 0.25).add(side).setY(0.08), p3,
    ]);
    const tube = part(new THREE.TubeGeometry(curve, 48, 0.06, 10, false), colors[i % colors.length], "hull");
    world.root.add(tube);
    const pulses: THREE.Mesh[] = [];
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c9 }));
      p.visible = false;
      world.root.add(p);
      pulses.push(p);
    }
    wires.push({ from: a, to: b, curve, pulses });
  }
  world.onTick((t) => {
    for (const w of wires) {
      const on = bus.flowing.has(w.from);
      w.pulses.forEach((p, k) => {
        p.visible = on;
        if (on) p.position.copy(w.curve.getPointAt((t * 0.8 + k / w.pulses.length) % 1)).setY(0.24);
      });
    }
  });
  return wires;
}

export function buildAll(world: World) {
  const all = [buildSource(), buildMic(), buildAdc(), buildFft(), buildMel(), buildEncoder(), buildTokens(), buildProjector(), buildLm(), buildHead(), buildVoice()];
  all.forEach((s) => {
    const box = new THREE.Box3().setFromObject(s.group);
    const tag = new THREE.Object3D();
    tag.position.set(0, box.max.y + 0.25, 0);
    s.group.add(tag);
    s.anchors.tag = tag;
    world.add(s);
    const d = DEFAULTS[s.id];
    if (d && s.screens.main) s.screens.main.idle = d;
  });
  const wires = buildWires(world);
  return { all, wires };
}
