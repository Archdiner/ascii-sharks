import * as THREE from "three";
import { lineMaterials } from "./toon";
import type { Screen } from "./screen";

export interface Station {
  id: string;
  name: string;
  group: THREE.Group;
  anchors: Record<string, THREE.Object3D>;
  screens: Record<string, Screen>;
  /** meshes that respond to clicks; userData.part names the part */
  pick: THREE.Object3D[];
  update?: (t: number, dt: number) => void;
  /** set by the active lesson */
  onClick?: ((part: string) => void) | null;
  /** short hover hint for clickable parts, set by the active lesson */
  hint?: ((part: string) => string | null) | null;
}

const EL = THREE.MathUtils.degToRad(32);
const DIST = 60;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly stations = new Map<string, Station>();
  readonly root = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private target = new THREE.Vector3();
  private yaw = THREE.MathUtils.degToRad(38);
  private zoom = 1;
  private goal = { target: new THREE.Vector3(), yaw: this.yaw, zoom: 1 };
  private from = { target: new THREE.Vector3(), yaw: this.yaw, zoom: 1 };
  private tween = 1;
  private tweenDur = 0.9;
  private viewH = 14;
  private ticks = new Set<(t: number, dt: number) => void>();
  private ray = new THREE.Raycaster();
  private last = performance.now();
  private t0 = performance.now();
  private hover: { station: Station; part: string } | null = null;
  onHover: ((h: { station: Station; part: string; x: number; y: number } | null) => void) | null = null;
  /** focused station ids (dims the rest) */
  private focusIds: string[] = [];
  private frameNo = 0;
  homeIds: string[] = [];

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "world-canvas";
    container.append(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.scene.add(this.root);

    const amb = new THREE.HemisphereLight(0xfff6e6, 0xd8c4a4, 2.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 17; sc.bottom = -17; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(amb, this.sun, this.sun.target);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x5a4022, opacity: 0.16 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(120, 120, 0xe2d3bb, 0xe8dcc7);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.75;
    grid.position.y = -0.004;
    this.scene.add(grid);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.bindInput();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  add(st: Station) {
    this.stations.set(st.id, st);
    this.root.add(st.group);
    st.group.traverse((o) => { o.userData.station = st.id; });
  }

  onTick(fn: (t: number, dt: number) => void) { this.ticks.add(fn); return () => this.ticks.delete(fn); }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const a = w / h;
    this.camera.left = (-this.viewH * a) / 2; this.camera.right = (this.viewH * a) / 2;
    this.camera.top = this.viewH / 2; this.camera.bottom = -this.viewH / 2;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    lineMaterials.forEach((m) => m.resolution.set(w * pr, h * pr));
  }

  get size() { return { w: this.container.clientWidth, h: this.container.clientHeight }; }

  private placeCamera() {
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(EL), Math.sin(EL), Math.cos(this.yaw) * Math.cos(EL));
    this.camera.position.copy(this.target).addScaledVector(dir, DIST);
    this.camera.lookAt(this.target);
    this.camera.zoom = this.zoom;
    this.camera.updateProjectionMatrix();
    this.sun.position.copy(this.target).add(new THREE.Vector3(-9, 22, 11));
    this.sun.target.position.copy(this.target);
  }

  /** Bring a set of stations into view, filling `fill` of the viewport. */
  focus(ids: string[], opts: { fill?: number; yaw?: number; offset?: [number, number]; dur?: number; instant?: boolean } = {}) {
    this.focusIds = ids;
    const box = new THREE.Box3();
    for (const id of ids) { const s = this.stations.get(id); if (s) box.expandByObject(s.group); }
    if (box.isEmpty()) return;
    const yaw = THREE.MathUtils.degToRad(opts.yaw ?? 38);
    const center = box.getCenter(new THREE.Vector3());
    // measure the box in camera space at the goal yaw
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(EL), Math.sin(EL), Math.cos(yaw) * Math.cos(EL));
    const up = new THREE.Vector3().crossVectors(dir, right).negate();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new THREE.Vector3(x, y, z).sub(center);
      const px = p.dot(right), py = p.dot(up);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    const { w, h } = this.size;
    const a = w / h;
    const fill = opts.fill ?? 0.62;
    const zoom = Math.min((this.viewH * a * fill) / (maxX - minX), (this.viewH * fill) / (maxY - minY));
    const t = center.clone().addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
    // offset in viewport fractions (e.g. to leave room for callout cards)
    const [ox, oy] = opts.offset ?? [0, 0];
    t.addScaledVector(right, (-ox * this.viewH * a) / zoom).addScaledVector(up, (oy * this.viewH) / zoom);
    this.from = { target: this.target.clone(), yaw: this.yaw, zoom: this.zoom };
    this.goal = { target: t, yaw, zoom: Math.max(0.35, Math.min(4.5, zoom)) };
    this.tweenDur = opts.dur ?? 1.1;
    this.tween = opts.instant ? 1 : 0;
    if (opts.instant) { this.target.copy(t); this.yaw = yaw; this.zoom = this.goal.zoom; }
  }

  rotate(deg: number) {
    this.from = { target: this.target.clone(), yaw: this.yaw, zoom: this.zoom };
    this.goal = { ...this.goal, target: this.target.clone(), yaw: this.yaw + THREE.MathUtils.degToRad(deg), zoom: this.zoom };
    this.tweenDur = 0.6; this.tween = 0;
  }
  zoomBy(f: number) {
    this.from = { target: this.target.clone(), yaw: this.yaw, zoom: this.zoom };
    this.goal = { target: this.target.clone(), yaw: this.yaw, zoom: Math.max(0.35, Math.min(5, this.zoom * f)) };
    this.tweenDur = 0.35; this.tween = 0;
  }

  get yawAngle() { return this.yaw; }

  /** Screen position (px, relative to the container) of a 3D point or object. */
  project(o: THREE.Object3D | THREE.Vector3) {
    const v = o instanceof THREE.Vector3 ? o.clone() : o.getWorldPosition(new THREE.Vector3());
    v.project(this.camera);
    const { w, h } = this.size;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, inView: Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 };
  }

  private pickAt(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const objs: THREE.Object3D[] = [];
    this.stations.forEach((s) => { if (s.onClick) objs.push(...s.pick); });
    const hit = this.ray.intersectObjects(objs, true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.part) o = o.parent;
    const st = this.stations.get(hit.object.userData.station);
    return st && o ? { station: st, part: o.userData.part as string } : null;
  }

  private bindInput() {
    const el = this.renderer.domElement;
    let drag: { x: number; y: number; moved: boolean } | null = null;
    el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false }; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          const k = this.viewH / this.zoom / this.size.h;
          const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
          const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          this.target.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.sin(EL));
          this.goal.target.copy(this.target); this.tween = 1;
          drag.x = e.clientX; drag.y = e.clientY;
        }
        return;
      }
      const h = this.pickAt(e.clientX, e.clientY);
      const r = el.getBoundingClientRect();
      el.style.cursor = h ? "pointer" : "grab";
      if (h?.station !== this.hover?.station || h?.part !== this.hover?.part) this.hover = h;
      this.onHover?.(h ? { ...h, x: e.clientX - r.left, y: e.clientY - r.top } : null);
    });
    el.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) { const h = this.pickAt(e.clientX, e.clientY); h?.station.onClick?.(h.part); }
      drag = null;
    });
    el.addEventListener("pointerleave", () => this.onHover?.(null));
    el.addEventListener("wheel", (e) => { e.preventDefault(); this.zoomBy(e.deltaY > 0 ? 0.88 : 1.14); }, { passive: false });
  }

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    if (this.tween < 1) {
      this.tween = Math.min(1, this.tween + dt / this.tweenDur);
      const u = 1 - Math.pow(1 - this.tween, 3);
      this.target.lerpVectors(this.from.target, this.goal.target, u);
      this.yaw = this.from.yaw + (this.goal.yaw - this.from.yaw) * u;
      this.zoom = this.from.zoom * Math.pow(this.goal.zoom / this.from.zoom, u);
    }
    this.placeCamera();
    this.frameNo++;
    this.stations.forEach((s) => {
      s.update?.(t, dt);
      // focused screens repaint every frame, the rest a few times a second
      const busy = this.focusIds.includes(s.id) || this.frameNo % 6 === 0;
      for (const sc of Object.values(s.screens)) { sc.face2(this.yaw); if (busy) sc.paint(t); }
    });
    this.ticks.forEach((f) => f(t, dt));
    this.renderer.render(this.scene, this.camera);
  }

  /** Render one station alone into a PNG for the lesson strip. */
  thumbnail(ids: string[], w = 220, h = 150): string {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setPixelRatio(2);
    r.setSize(w, h, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const keep = new Map<THREE.Object3D, boolean>();
    this.root.children.forEach((c) => { keep.set(c, c.visible); c.visible = ids.some((id) => this.stations.get(id)?.group === c); });
    this.scene.children.forEach((c) => { if (c instanceof THREE.GridHelper || (c as THREE.Mesh).material instanceof THREE.ShadowMaterial) { keep.set(c, c.visible); c.visible = false; } });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const box = new THREE.Box3();
    ids.forEach((id) => { const s = this.stations.get(id); if (s) box.expandByObject(s.group); });
    const center = box.getCenter(new THREE.Vector3());
    const yaw = THREE.MathUtils.degToRad(38);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(EL), Math.sin(EL), Math.cos(yaw) * Math.cos(EL));
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z) * 0.95 + size.y * 0.5;
    const a = w / h;
    cam.left = (-span * a) / 2; cam.right = (span * a) / 2; cam.top = span / 2; cam.bottom = -span / 2;
    cam.position.copy(center).addScaledVector(dir, DIST);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    const saved = [...lineMaterials].map((m) => m.resolution.clone());
    lineMaterials.forEach((m) => m.resolution.set(w * 2, h * 2));
    r.render(this.scene, cam);
    const url = r.domElement.toDataURL("image/png");
    [...lineMaterials].forEach((m, i) => m.resolution.copy(saved[i]));
    keep.forEach((v, o) => (o.visible = v));
    r.dispose();
    r.forceContextLoss();
    return url;
  }

  get focused() { return this.focusIds; }
}

