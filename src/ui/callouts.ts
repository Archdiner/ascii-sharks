import type * as THREE from "three";
import type { World } from "../scene/world";
import { icon } from "./icons";
import { el } from "./dom";

export type Slot = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "br";

export interface Placed {
  anchor: THREE.Object3D;
  icon: string;
  title: string;
  text: string;
  slot?: Slot;
  /** optional live value shown under the title, refreshed ~8× a second */
  value?: () => string;
}

const SLOTS: Slot[] = ["tl", "tc", "tr", "bl", "br", "ml", "mr"];

/**
 * Callout cards around the stage, each tied to a point on a 3D part by a dashed leader line,
 * the way the reference labels the Arduino board.
 */
export class Callouts {
  private layer: HTMLElement;
  private svg: SVGSVGElement;
  private items: { p: Placed; card: HTMLElement; val: HTMLElement | null; slot: Slot }[] = [];
  private tags: { anchor: THREE.Object3D; el: HTMLElement }[] = [];
  private tip: HTMLElement;
  private linked: { anchor: THREE.Object3D; el: HTMLElement } | null = null;
  private last = 0;
  readonly list: HTMLElement;

  constructor(private stage: HTMLElement, private world: World) {
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("leaders");
    this.layer = el("div", { class: "callouts" });
    this.tip = el("div", { class: "tip", role: "tooltip" });
    this.list = el("ol", { class: "callout-list" });
    stage.append(this.svg, this.layer, this.tip);
    world.onTick(() => this.tick());
    world.onHover = (h) => {
      const text = h ? this.world.hintFor(h.station, h.part) : null;
      this.tip.classList.toggle("is-on", !!text);
      if (text && h) {
        this.tip.textContent = text;
        this.tip.style.transform = `translate(${h.x + 14}px, ${h.y + 14}px)`;
      }
    };
  }

  private lastList: Placed[] = [];

  /** bring back cards the reader closed */
  restore() { this.set(this.lastList); }

  private dismiss(card: HTMLElement) {
    this.items = this.items.filter((i) => i.card !== card);
    card.classList.remove("is-in");
    setTimeout(() => card.remove(), 200);
  }

  set(list: Placed[]) {
    this.lastList = list;
    this.layer.querySelectorAll(".callout").forEach((n) => n.remove());
    this.items = [];
    this.list.innerHTML = "";
    const used = new Set<Slot>();
    // explicit slots first, then the nearest free slot to where the anchor sits on screen
    const order = [...list].sort((a, b) => Number(!!b.slot) - Number(!!a.slot));
    for (const p of order) {
      let slot = p.slot && !used.has(p.slot) ? p.slot : undefined;
      if (!slot) {
        const { x, y } = this.world.project(p.anchor);
        const { w, h } = this.world.size;
        const want: Slot = y < h * 0.4 ? (x < w * 0.33 ? "tl" : x > w * 0.66 ? "tr" : "tc") : y > h * 0.62 ? (x < w * 0.5 ? "bl" : "br") : x < w * 0.5 ? "ml" : "mr";
        slot = used.has(want) ? SLOTS.find((s) => !used.has(s))! : want;
      }
      used.add(slot);
      const val = p.value ? el("b", { class: "co-val" }, "") : null;
      const close = el("button", { type: "button", class: "co-x", title: "Close", "aria-label": `Close ${p.title}`, html: icon("close") });
      const card = el("div", { class: `callout slot-${slot}` },
        el("span", { class: "co-ic", html: icon(p.icon) }),
        el("div", { class: "co-body" }, el("h4", {}, p.title), val, el("p", {}, p.text)), close);
      close.addEventListener("click", () => this.dismiss(card));
      this.layer.append(card);
      this.items.push({ p, card, val, slot });
      this.list.append(el("li", {}, el("span", { class: "co-ic", html: icon(p.icon) }), el("div", {}, el("b", {}, p.title), el("p", {}, p.text))));
    }
    requestAnimationFrame(() => this.items.forEach((i) => i.card.classList.add("is-in")));
  }

  /** a leader from a panel (the inspector) to a point in the scene */
  link(anchor: THREE.Object3D | null, panel: HTMLElement) {
    this.linked = anchor ? { anchor, el: panel } : null;
  }

  setTags(tags: { anchor: THREE.Object3D; label: string; num: number; lit?: boolean; onClick: () => void }[]) {
    this.tags.forEach((t) => t.el.remove());
    this.tags = tags.map((t) => {
      const b = el("button", { type: "button", class: `stag${t.lit ? " is-lit" : ""}` }, el("span", {}, String(t.num).padStart(2, "0")), t.label);
      b.addEventListener("click", t.onClick);
      this.layer.append(b);
      return { anchor: t.anchor, el: b };
    });
  }

  private tick() {
    const sr = this.stage.getBoundingClientRect();
    this.svg.setAttribute("viewBox", `0 0 ${sr.width} ${sr.height}`);
    let paths = "";
    const now = performance.now();
    const refresh = now - this.last > 120;
    if (refresh) this.last = now;
    const labelsOff = this.stage.classList.contains("no-labels");
    for (const { p, card, val, slot } of labelsOff ? [] : this.items) {
      if (refresh && val && p.value) val.textContent = p.value();
      const a = this.world.project(p.anchor);
      // an anchor that has left the stage gets no leader rather than a line across the page
      const offStage = a.x < 0 || a.y < 0 || a.x > sr.width || a.y > sr.height;
      card.classList.toggle("is-unlinked", offStage);
      if (offStage) continue;
      const cr = card.getBoundingClientRect();
      const cx = cr.left - sr.left, cy = cr.top - sr.top;
      let sx: number, sy: number, ex: number, ey: number;
      if (slot.startsWith("t")) { sx = cx + cr.width / 2; sy = cy + cr.height; ex = sx; ey = sy + 18; }
      else if (slot.startsWith("b")) { sx = cx + cr.width / 2; sy = cy; ex = sx; ey = sy - 18; }
      else if (slot === "ml") { sx = cx + cr.width; sy = cy + cr.height / 2; ex = sx + 18; ey = sy; }
      else { sx = cx; sy = cy + cr.height / 2; ex = sx - 18; ey = sy; }
      // start from the side of the card nearest the anchor for top/bottom cards
      if (slot.startsWith("t") || slot.startsWith("b")) {
        const nx = Math.max(cx + 22, Math.min(cx + cr.width - 22, a.x));
        sx = nx; ex = nx;
      }
      paths += `<path d="M${sx},${sy} L${ex},${ey} L${a.x},${a.y}" class="ld"/><circle cx="${sx}" cy="${sy}" r="3.2" class="ld-end"/><circle cx="${a.x}" cy="${a.y}" r="5" class="ld-dot"/><circle cx="${a.x}" cy="${a.y}" r="2" class="ld-core"/>`;
    }
    const la = this.linked && !this.linked.el.hidden ? this.world.project(this.linked.anchor) : null;
    if (this.linked && la && la.x >= 0 && la.y >= 0 && la.x <= sr.width && la.y <= sr.height) {
      const a = la;
      const r = this.linked.el.getBoundingClientRect();
      const sx = r.left - sr.left, sy = r.top - sr.top + 22;
      paths += `<path d="M${sx},${sy} L${sx - 16},${sy} L${a.x},${a.y}" class="ld ld-insp"/><circle cx="${sx}" cy="${sy}" r="3.2" class="ld-end"/><circle cx="${a.x}" cy="${a.y}" r="5" class="ld-dot"/><circle cx="${a.x}" cy="${a.y}" r="2" class="ld-core"/>`;
    }
    this.svg.innerHTML = paths;
    for (const t of this.tags) {
      const a = this.world.project(t.anchor);
      t.el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -100%)`;
    }
  }
}
