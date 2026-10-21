import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** Scene palette. Matches the CSS tokens so the 3D parts and the cards read as one illustration. */
export const C = {
  ink: 0x18213d,
  navy: 0x24304a,
  pcb: 0x2d4479,
  pcbDark: 0x223562,
  cream: 0xf1e6d2,
  paper: 0xfbf6ec,
  sand: 0xdcc9ab,
  wood: 0xc99a68,
  teal: 0x1aa3a1,
  tealLight: 0x7fd0c9,
  orange: 0xf0a53a,
  red: 0xd2553f,
  chip: 0x2a2e38,
  metal: 0xb9bcc4,
  metalDark: 0x7d828d,
  white: 0xfffaf2,
  black: 0x23262e,
};

// Three-step toon ramp: shadow, mid, lit. Gives the flat "illustrated" shading.
const ramp = (() => {
  const d = new Uint8Array([150, 150, 150, 255, 205, 205, 205, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();

const matCache = new Map<string, THREE.Material>();
export function toon(color: number, opts: { transparent?: boolean; opacity?: number; emissive?: number } = {}): THREE.MeshToonMaterial {
  const key = `${color}|${opts.opacity ?? 1}|${opts.emissive ?? 0}`;
  let m = matCache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: ramp, transparent: opts.transparent || (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, emissive: opts.emissive ?? 0 });
    matCache.set(key, m);
  }
  return m;
}

/** Fresh (uncached) toon material, for parts whose colour animates. */
export function toonLive(color: number, emissive = 0x000000) {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, emissive });
}

// Every line material needs the viewport size to draw pixel-width lines.
export const lineMaterials = new Set<LineMaterial>();
const lineCache = new Map<string, LineMaterial>();
export function lineMat(width = 1.7, color = C.ink, opacity = 1) {
  const key = `${width}|${color}|${opacity}`;
  let m = lineCache.get(key);
  if (!m) {
    m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, worldUnits: false });
    lineMaterials.add(m);
    lineCache.set(key, m);
  }
  return m;
}

/** Ink lines on hard edges (creases sharper than `angle` degrees). */
export function edges(mesh: THREE.Mesh, angle = 35, width = 1.7, color = C.ink) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, angle);
  const g = new LineSegmentsGeometry().fromEdgesGeometry(eg);
  const l = new LineSegments2(g, lineMat(width, color));
  l.raycast = () => {};
  mesh.add(l);
  return mesh;
}

// Inverted-hull silhouette for smooth parts (cylinders, spheres, tubes) where edges alone miss the outline.
const hullMat = (() => {
  const m = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.thickness = { value: 0.022 };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float thickness;")
      .replace("#include <begin_vertex>", "vec3 transformed = position + normalize(normal) * thickness;");
  };
  return m;
})();

export function hull(mesh: THREE.Mesh, thickness = 0.022) {
  const h = new THREE.Mesh(mesh.geometry, hullMat);
  h.raycast = () => {};
  if (thickness !== 0.022) h.scale.setScalar(1 + thickness * 2);
  mesh.add(h);
  return mesh;
}

/** Mesh helper: geometry + toon colour + outline + shadows in one call. */
export function part(geo: THREE.BufferGeometry, color: number | THREE.Material, line: "edges" | "hull" | "both" | "none" = "edges", angle = 35) {
  const m = new THREE.Mesh(geo, typeof color === "number" ? toon(color) : color);
  m.castShadow = true;
  m.receiveShadow = true;
  if (line === "edges" || line === "both") edges(m, angle);
  if (line === "hull" || line === "both") hull(m);
  return m;
}

/** Rounded box: extruded rounded rectangle, bevelled, lying flat (x-z), height along y. */
export function roundBox(w: number, h: number, d: number, r = 0.12, bevel = 0.03) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  g.computeVertexNormals();
  return g;
}

/** Canvas-backed texture for printed labels and live screens. */
export function canvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { canvas, g, tex };
}

/** A flat printed label (silkscreen) lying on a surface. */
export function decal(text: string, w: number, h: number, opts: { color?: string; bg?: string; weight?: string; align?: "center" | "left" } = {}) {
  const px = 160;
  const { g, tex } = canvasTexture(Math.round(w * px), Math.round(h * px));
  const W = g.canvas.width, H = g.canvas.height;
  if (opts.bg) { g.fillStyle = opts.bg; g.fillRect(0, 0, W, H); }
  g.fillStyle = opts.color ?? "#fbf6ec";
  // largest font that fits both the height and the width
  let size = H * 0.78;
  const font = (s: number) => `${opts.weight ?? "700"} ${s}px "Barlow Semi Condensed", "Barlow", sans-serif`;
  g.font = font(size);
  const tw = g.measureText(text).width;
  if (tw > W * 0.94) { size *= (W * 0.94) / tw; g.font = font(size); }
  g.textAlign = opts.align ?? "center";
  g.textBaseline = "middle";
  g.fillText(text, opts.align === "left" ? W * 0.03 : W / 2, H / 2 + H * 0.04);
  tex.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.raycast = () => {};
  return m;
}
