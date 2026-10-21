import "./style.css";
import { audio } from "./audio/engine";
import { SPECIMENS } from "./audio/specimens";
import { el } from "./ui/dom";
import { icon } from "./ui/icons";
import { highlight } from "./ui/code";
import { Callouts } from "./ui/callouts";
import { World } from "./scene/world";
import { buildAll, ORDER } from "./scene/stations";
import { bus } from "./scene/bus";
import type { Draw } from "./scene/screen";
import { getPipe, setPipe, onPipe, describe } from "./pipeline";
import { analyse, feedScene, sharedBooks, labelLogits, type Analysis } from "./analysis";
import type { Ctx, Lesson, LogKind, Callout } from "./types";
import { LESSONS } from "./lessons";

const COURSE = LESSONS.filter((l) => !l.intro);
const STORE = "hcl-progress-v2";
const done: Set<string> = (() => { try { return new Set(JSON.parse(localStorage.getItem(STORE) ?? "[]")); } catch { return new Set(); } })();
const saveDone = () => { try { localStorage.setItem(STORE, JSON.stringify([...done])); } catch { /* private mode */ } };

const LOGO = `<svg class="brand-logo" viewBox="0 0 92 50" aria-hidden="true"><path class="loop" d="M4 25h8l4-12 6 26 6-34 6 38 6-30 6 20 4-8h8"/><path class="sign" d="M66 13c8 0 14 5 14 12s-6 12-14 12M70 19c4 0 6 3 6 6s-2 6-6 6"/></svg>`;
const NAV = (name: string, ic: string, label: string, href = "#") => `<li><a href="${href}" data-nav="${name}" title="${label}">${icon(ic)}<span class="side-label">${label}</span></a></li>`;

// ---------------------------------------------------------------- layout

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="loader" id="loader" role="status" aria-live="polite">
    <div class="loader-inner">${LOGO}<p class="loader-title">How Computers Listen</p>
      <div class="loader-track"><span class="loader-fill" id="loader-fill"></span></div><p class="loader-step" id="loader-step">Building the machine</p></div>
  </div>
  <nav class="sidebar" aria-label="Main">
    <ul class="side-nav">
      ${NAV("home", "target", "Home", "#intro")}
      ${NAV("lessons", "book", "Lessons")}
      ${NAV("sounds", "wave", "Sounds")}
      ${NAV("voice", "mic", "Your voice, end to end", "#journey")}
      ${NAV("settings", "knob", "Settings")}
    </ul>
  </nav>
  <aside class="flyout" id="flyout" aria-live="polite"></aside>

  <header class="brand">
    ${LOGO}
    <span class="brand-rule" aria-hidden="true"></span>
    <div class="brand-text"><h1>How Computers Listen</h1><p>Capture <i>·</i> Represent <i>·</i> Understand</p></div>
  </header>

  <section class="status" aria-label="Progress">
    <div class="progress-card">
      ${icon("book", "progress-icon")}
      <div class="progress-body">
        <span class="progress-label" id="progress-label">Capture</span>
        <div class="progress-row">
          <span class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${COURSE.length}" id="progress-bar"><span class="progress-fill" id="progress-fill"></span></span>
          <span class="progress-count" id="progress-count">0/${COURSE.length}</span>
        </div>
      </div>
    </div>
    <div class="mini-card" title="How much data flows through this point of the pipeline">
      <span class="mini-label">Data rate here</span><b id="rate-value">—</b><small id="rate-note"></small>
    </div>
    <button class="mini-card mini-pipe" id="pipe-card" type="button" title="Your pipeline settings. Lessons change these; the end-to-end view uses them.">
      <span class="mini-label">Your pipeline ›</span><b id="pipe-value"></b>
    </button>
  </section>

  <main class="stage" id="stage">
    <div class="world" id="world"></div>
    <div class="viewbar" id="viewbar" role="toolbar" aria-label="Sound and view"></div>
    <section class="inspector" id="inspector" hidden>
      <header><span id="insp-title">Monitor</span><button class="insp-btn" id="insp-big" title="Enlarge" aria-label="Enlarge">${icon("screen")}</button></header>
      <canvas id="insp-canvas"></canvas>
    </section>
    <div class="screen-view" id="screen-view" hidden>
      <header><b id="sv-title">Screen</b><button class="sv-close" id="sv-close" aria-label="Close">${icon("cut")}</button></header>
      <canvas id="sv-canvas"></canvas>
    </div>
  </main>

  <section class="info-card" aria-label="Lesson">
    <div class="tabs" role="tablist" id="tabs"></div>
    <div class="info-body" id="info-body">
      <div class="pane pane-overview" id="pane-overview"></div>
      <div class="pane" id="pane-steps" hidden></div>
      <div class="pane pane-lost" id="pane-lost" hidden></div>
      <div class="pane" id="pane-specs" hidden></div>
    </div>
    <div class="info-foot">
      <button class="btn-ghost" id="prev" type="button">← Prev</button>
      <button class="btn-next" id="next" type="button">Next →</button>
    </div>
  </section>

  <section class="code-card" aria-label="Try it yourself" data-state="idle" id="code-card">
    <header>
      <h2>Try it yourself</h2>
      <div class="code-actions">
        <button class="btn-ghost btn-icon" id="copy" aria-label="Copy code" title="Copy code"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="12.5" rx="1.6"/><path d="M15.5 5.2V4.8c0-.9-.7-1.6-1.6-1.6H6.1c-.9 0-1.6.7-1.6 1.6v9.6c0 .9.7 1.6 1.6 1.6h.4"/></svg></button>
        <button class="btn-run" id="run" aria-label="Run on the current sound" title="Run on the current sound (R)"><svg viewBox="0 0 24 24"><path d="M7.5 4.8v14.4L19 12z" class="fill"/></svg></button>
      </div>
    </header>
    <div class="code-wrap">
      <pre class="code"><code id="code"></code></pre>
      <div class="console">
        <div class="console-head"><span class="console-dot"></span><span class="console-title">Signal monitor</span><span class="console-status" id="console-status">Stopped</span>
          <button class="console-close" id="console-clear" aria-label="Clear" title="Clear"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button></div>
        <div class="console-lines" id="console" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section class="lessons" aria-label="Lessons">
    <h2>Lessons</h2>
    <div class="strip"><button class="strip-nav" id="strip-prev" aria-label="Scroll lessons left">‹</button><ol class="lesson-list" id="lesson-list"></ol><button class="strip-nav" id="strip-next" aria-label="Scroll lessons right">›</button></div>
  </section>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const consoleEl = $("console");
const codeCard = $("code-card");

// ---------------------------------------------------------------- world

const world = new World($("world"));
const { all: stations } = buildAll(world);
const callouts = new Callouts(stage, world);
stage.append(callouts.list);

// analyser → scene, every frame
world.onTick(() => {
  bus.live = audio.live;
  bus.sr = audio.sampleRate;
  if (audio.analyser && bus.live) {
    audio.timeData(bus.time);
    audio.freqData(bus.spec);
    let s = 0;
    for (let i = bus.time.length - 1024; i < bus.time.length; i++) s += bus.time[i] * bus.time[i];
    const lv = Math.min(1, Math.sqrt(s / 1024) * 4);
    bus.level += (lv - bus.level) * (lv > bus.level ? 0.5 : 0.1);
  } else {
    bus.level *= 0.9;
  }
  const p = audio.position();
  bus.head = flowHead >= 0 ? flowHead : p >= 0 && audio.playing === "clip" ? p / audio.duration : -1;
});

// ---------------------------------------------------------------- analysis of the current sound

let current: Lesson = LESSONS[0];
let analysis: Analysis | null = null;
let changeSubs: (() => void)[] = [];
let flowHead = -1;

function reanalyse() {
  analysis = analyse(audio.clip, getPipe());
  feedScene(analysis);
  changeSubs.forEach((f) => f());
  $("pipe-value").textContent = describe(getPipe());
  const r = current.rate(getPipe());
  $("rate-value").textContent = r.value;
  $("rate-note").textContent = r.note;
}
audio.on(() => { if (!analysis || analysis.clip !== audio.clip) reanalyse(); renderViewbar(); });
let pipeTimer = 0;
onPipe(() => { $("pipe-value").textContent = describe(getPipe()); clearTimeout(pipeTimer); pipeTimer = window.setTimeout(reanalyse, 140); });

// ---------------------------------------------------------------- console

function log(text: string, kind: LogKind = "info") {
  const now = new Date();
  const ts = `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  consoleEl.append(el("div", { class: `cl cl-${kind}` }, el("span", { class: "ts" }, ts), el("span", { class: "tx" }, text)));
  while (consoleEl.children.length > 200) consoleEl.firstChild?.remove();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function setRunState(s: "idle" | "running" | "done") {
  codeCard.dataset.state = s;
  $("console-status").textContent = s === "running" ? "Running" : s === "done" ? "Done" : "Stopped";
}
$("console-clear").addEventListener("click", () => { consoleEl.innerHTML = ""; setRunState("idle"); });

// ---------------------------------------------------------------- lesson context

const ov = $("pane-overview");
let rowsEl: HTMLElement, statsEl: HTMLElement;
let primary: { station: string; key: string; draw: Draw } | null = null;
const touched = new Set<string>();

function resolve(c: Callout) {
  const [sid, a] = c.at.split(".");
  const st = world.stations.get(sid)!;
  return { anchor: st.anchors[a] ?? st.anchors.screen ?? st.group, icon: c.icon, title: c.title, text: c.text, slot: c.slot, value: c.value };
}

const ctx: Ctx = {
  audio, world, log,
  go: (id) => go(id),
  row(ic, html, control) {
    const text = el("div", { class: "row-text", html });
    const r = el("div", { class: "row" }, el("span", { class: "row-ic", html: icon(ic) }), el("div", { class: "row-main" }, text, control ?? null));
    rowsEl.append(r);
    return { el: r, text: (h) => { text.innerHTML = h; } };
  },
  stat(label, cls = "") {
    const b = el("b", {}, "—");
    statsEl.append(el("div", { class: `stat ${cls}` }, el("small", {}, label), b));
    return { set: (v) => { if (b.textContent !== v) b.textContent = v; } };
  },
  screen(sid, draw, opts = {}) {
    const key = opts.key ?? "main";
    const sc = world.stations.get(sid)?.screens[key];
    if (!sc) return;
    sc.draw = draw;
    touched.add(`${sid}.${key}`);
    if (draw && opts.primary !== false && (!primary || opts.primary)) primary = { station: sid, key, draw };
    $("sv-btn")?.toggleAttribute("disabled", !primary);
  },
  click(sid, fn, hint) {
    const st = world.stations.get(sid);
    if (!st) return;
    st.onClick = fn;
    st.hint = hint ?? null;
  },
  callouts: (list) => callouts.set(list.map(resolve)),
  focus: (ids, o) => world.focus(ids, o),
  pipe: getPipe,
  setPipe,
  analysis: () => analysis ?? analyse(audio.clip, getPipe()),
  onChange: (fn) => { changeSubs.push(fn); },
  flow: (o) => flow(o),
  stopFlow: () => stopFlow(),
  expand: () => openScreen(),
  setTags: (t) => callouts.setTags(t.map((x) => ({ ...x, anchor: world.stations.get(x.station)!.anchors.tag }))),
};

// ---------------------------------------------------------------- rendering a lesson

const TABS: [string, string][] = [["overview", "Overview"], ["steps", "How it works"], ["lost", "What's lost"], ["specs", "Words & specs"]];
let activeTab = "overview";

function renderTabs() {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const [k, name] of TABS) {
    const b = el("button", { role: "tab", type: "button", class: `${k === activeTab ? "is-active" : ""}${k === "lost" ? " tab-lost" : ""}`, "aria-selected": String(k === activeTab) }, name);
    b.addEventListener("click", () => { activeTab = k; renderTabs(); });
    tabs.append(b);
  }
  for (const [k] of TABS) $(`pane-${k}`).hidden = k !== activeTab;
  $("info-body").scrollTop = 0;
}

function renderPanes(l: Lesson) {
  const idx = COURSE.indexOf(l);
  ov.innerHTML = "";
  ov.append(
    el("div", { class: "ic-head" }, el("span", { class: "kicker" }, l.intro ? "Start here" : `Lesson ${idx + 1} of ${COURSE.length} · ${l.chapter}`), el("h2", {}, l.title)),
    el("p", { class: "summary", html: l.summary }),
  );
  rowsEl = el("div", { class: "rows" });
  statsEl = el("div", { class: "stat-row" });
  ov.append(rowsEl, statsEl);
  $("pane-steps").innerHTML = `<h3>How it works</h3><ol class="steps">${l.steps.map((s, i) => `<li><span>${i + 1}</span><p>${s}</p></li>`).join("")}</ol>`;
  $("pane-lost").innerHTML = `<h3>What's lost at this step</h3>${l.lost}`;
  $("pane-specs").innerHTML =
    (l.words.length ? `<h3>Words</h3><dl class="words">${l.words.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>` : "") +
    (l.specs.length ? `<h3>Numbers</h3><dl class="specs">${l.specs.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>` : "");
  [ov, $("pane-steps"), $("pane-lost"), $("pane-specs")].forEach((p) => p.querySelectorAll<HTMLAnchorElement>("a[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.go!); })));
}

let unmount: (() => void) | void;

function show(l: Lesson) {
  if (typeof unmount === "function") unmount();
  unmount = undefined;
  stopFlow();
  audio.stop();
  touched.forEach((k) => { const [sid, key] = k.split("."); const sc = world.stations.get(sid)?.screens[key]; if (sc) sc.draw = null; });
  touched.clear();
  stations.forEach((s) => { s.onClick = null; s.hint = null; });
  bus.glow.clear();
  bus.flowing.clear();
  primary = null;
  closeScreen();
  insp.hidden = true;
  changeSubs = [];
  current = l;
  activeTab = "overview";
  renderPanes(l);
  renderTabs();
  $("code").innerHTML = highlight(l.code);
  ($("prev") as HTMLButtonElement).disabled = l === LESSONS[0];
  const idx = COURSE.indexOf(l);
  $("next").textContent = idx === COURSE.length - 1 ? "Back to start ↺" : l.intro ? "Start lesson 1 →" : "Next lesson →";
  $("progress-label").textContent = l.intro ? "Course" : l.chapter;
  const r = l.rate(getPipe());
  $("rate-value").textContent = r.value;
  $("rate-note").textContent = r.note;
  world.focus(l.focus, l.view);
  callouts.setTags([]);
  callouts.set(l.callouts.map(resolve));
  consoleEl.innerHTML = "";
  setRunState("idle");
  log(l.intro ? "Press ▶ to see the whole pipeline's numbers for the current sound." : `Press ▶ to run this step on "${audio.clip.name}".`, "dim");
  unmount = l.mount(ctx);
  $("sv-btn")?.toggleAttribute("disabled", !primary);
  showInspector();
  // with the inspector docked on the right, slide the machine left so it stays in view
  if (primary) resetView();
  renderLessonList();
  document.title = l.intro ? "How Computers Listen" : `${l.title} · How Computers Listen`;
}

function go(id: string) {
  if (location.hash.slice(1) !== id) location.hash = id;
  else route();
}
function route() {
  const id = location.hash.slice(1);
  const l = LESSONS.find((x) => x.id === id) ?? LESSONS[0];
  if (l !== current || unmount === undefined) show(l);
}
window.addEventListener("hashchange", route);

function step(d: number) {
  const i = LESSONS.indexOf(current);
  if (d > 0) markDone(current);
  go((LESSONS[i + d] ?? LESSONS[d > 0 ? 0 : i]).id);
}
$("next").addEventListener("click", () => step(1));
$("prev").addEventListener("click", () => step(-1));
$("pipe-card").addEventListener("click", () => go("journey"));

function markDone(l: Lesson) {
  if (l.intro || done.has(l.id)) return;
  done.add(l.id);
  saveDone();
  renderLessonList();
}

async function run() {
  if (codeCard.dataset.state === "running") return;
  setRunState("running");
  const l = current;
  log(`$ python ${l.id}.py`, "head");
  try {
    await l.run(ctx);
    if (l === current) { setRunState("done"); markDone(l); }
  } catch (e) {
    log(String((e as Error)?.message ?? e), "warn");
    setRunState("idle");
  }
}
$("run").addEventListener("click", run);
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(current.code); log("Copied to clipboard.", "dim"); } catch { log("Clipboard isn't available here.", "warn"); }
});

// ---------------------------------------------------------------- lesson strip with rendered pictures

const thumbs = new Map<string, string>();
function renderLessonList() {
  const list = $("lesson-list");
  list.innerHTML = "";
  COURSE.forEach((l, i) => {
    const key = l.thumb.join(",");
    const li = el("li", { class: `${l === current ? "is-current" : ""}${done.has(l.id) ? " is-done" : ""}` });
    li.append(el("a", { href: `#${l.id}` },
      thumbs.get(key) ? el("img", { src: thumbs.get(key)!, alt: "" }) : el("span", { class: "thumb-ph" }),
      el("span", { class: "lesson-meta" }, el("b", {}, `${i + 1}. ${l.short}`)),
      el("span", { class: "lesson-chev", html: "›" }),
    ));
    list.append(li);
  });
  // centre the current card by scrolling the strip only (scrollIntoView would also scroll the page)
  const cur = list.querySelector<HTMLElement>(".is-current");
  if (cur) list.scrollTo({ left: cur.offsetLeft - list.clientWidth / 2 + cur.clientWidth / 2, behavior: "smooth" });
  const n = COURSE.filter((l) => done.has(l.id)).length;
  $("progress-count").textContent = `${n}/${COURSE.length}`;
  $("progress-fill").style.width = `${(n / COURSE.length) * 100}%`;
  $("progress-bar").setAttribute("aria-valuenow", String(n));
}
$("strip-prev").addEventListener("click", () => $("lesson-list").scrollBy({ left: -480, behavior: "smooth" }));
$("strip-next").addEventListener("click", () => $("lesson-list").scrollBy({ left: 480, behavior: "smooth" }));

// ---------------------------------------------------------------- screen view (enlarge a monitor)

const sv = $("screen-view"), svCanvas = $<HTMLCanvasElement>("sv-canvas");
let svStop: (() => void) | null = null;
function openScreen() {
  if (!primary) return;
  sv.hidden = false;
  $("sv-title").textContent = `${world.stations.get(primary.station)?.name ?? ""} screen`;
  const g = svCanvas.getContext("2d")!;
  let alive = true;
  const tick = (t: number) => {
    if (!alive || !primary) return;
    const r = svCanvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (svCanvas.width !== w || svCanvas.height !== h) { svCanvas.width = w; svCanvas.height = h; }
    g.save();
    primary.draw(g, w, h, t / 1000);
    g.restore();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  svStop = () => { alive = false; };
}
function closeScreen() { sv.hidden = true; svStop?.(); svStop = null; }
$("sv-close").addEventListener("click", closeScreen);

// ---------------------------------------------------------------- inspector: the lesson's main monitor, drawn large

const insp = $("inspector"), inspCanvas = $<HTMLCanvasElement>("insp-canvas");
function showInspector() {
  if (!primary) { insp.hidden = true; callouts.link(null, insp); return; }
  const st = world.stations.get(primary.station)!;
  const sc = st.screens[primary.key];
  insp.hidden = false;
  insp.style.setProperty("--aspect", String(sc.canvas.width / sc.canvas.height));
  $("insp-title").textContent = `${st.name} monitor`;
  callouts.link(st.anchors.screen ?? st.group, insp);
}
world.onTick((t) => {
  if (insp.hidden || !primary) return;
  const r = inspCanvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (w < 2 || h < 2) return;
  if (inspCanvas.width !== w || inspCanvas.height !== h) { inspCanvas.width = w; inspCanvas.height = h; }
  const g = inspCanvas.getContext("2d")!;
  g.save();
  primary.draw(g, w, h, t);
  g.restore();
});
$("insp-big").addEventListener("click", () => openScreen());

// ---------------------------------------------------------------- view bar: sound + camera

const viewbar = $("viewbar");
function renderViewbar() {
  const c = audio.clip;
  const playing = audio.playing === "clip";
  viewbar.innerHTML = "";
  const sel = el("select", { class: "src-select", "aria-label": "Sound" },
    ...SPECIMENS.map((s) => el("option", { value: s.id, selected: c.id === s.id }, s.name)),
    c.source !== "specimen" ? el("option", { value: c.id, selected: true }, c.name) : null);
  sel.addEventListener("change", () => audio.useSpecimen(sel.value));
  const vb = (ic: string, label: string, fn: () => void, cls = "", title = label) => {
    const b = el("button", { type: "button", class: `vb ${cls}`, title, "aria-label": title }, el("span", { html: icon(ic) }), label ? el("span", { class: "vb-t" }, label) : null);
    b.addEventListener("click", fn);
    return b;
  };
  const rec = vb("record", "Record", async () => {
    rec.setAttribute("disabled", "");
    try {
      log("Recording 4 seconds. Say something, clap, or whistle.", "info");
      await audio.record(4, (t) => { rec.querySelector(".vb-t")!.textContent = `${Math.max(0, 4 - t).toFixed(1)} s`; });
      log("Recorded. Every station now shows your recording.", "ok");
    } catch { log("The microphone isn't available (permission denied or no device).", "warn"); rec.removeAttribute("disabled"); renderViewbar(); }
  }, "vb-rec", "Record 4 seconds and use it everywhere");
  const file = el("input", { type: "file", accept: "audio/*", class: "sr-only", id: "file-in" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try { await audio.loadFile(f); log(`Loaded "${f.name}" (first 6 seconds).`, "ok"); } catch { log("Couldn't decode that file.", "warn"); }
  });
  const up = el("label", { class: "vb", for: "file-in", title: "Use your own audio file" }, el("span", { html: icon("sheet") }));
  viewbar.append(
    el("span", { class: "vb-label" }, "Sound"), sel,
    vb(playing ? "record" : "play", playing ? "Stop" : "Play", togglePlay, `vb-play${playing ? " is-on" : ""}`, "Play or stop the sound (Space)"),
    vb("mic", audio.micOn ? "Live" : "", async () => { try { audio.micOn ? audio.stopMic() : await audio.startMic(); } catch { log("The microphone isn't available.", "warn"); } }, audio.micOn ? "is-live" : "", "Listen to your microphone live"),
    rec, up, file,
    el("span", { class: "vb-sep" }),
    vb("loop", "", () => world.rotate(-45), "", "Turn left (Q)"),
    vb("loop", "", () => world.rotate(45), "vb-flip", "Turn right (E)"),
    vb("filter", "", () => world.zoomBy(0.8), "", "Zoom out (−)"),
    vb("target", "", () => resetView(), "", "Reset view (0)"),
    vb("grid", "", () => world.zoomBy(1.25), "", "Zoom in (+)"),
    (() => { const b = vb("screen", "", openScreen, "", "Enlarge this lesson's screen"); b.id = "sv-btn"; if (!primary) b.setAttribute("disabled", ""); return b; })(),
  );
}
function resetView() {
  const l = current;
  const docked = primary && window.innerWidth > 1100;
  if (docked) world.focus(l.focus, { ...l.view, fill: (l.view?.fill ?? 0.62) * 0.86, offset: [(l.view?.offset?.[0] ?? 0) - 0.15, l.view?.offset?.[1] ?? 0] });
  else world.focus(l.focus, l.view);
}
function togglePlay() { if (audio.playing) audio.stop(); else audio.playClip(); }

// ---------------------------------------------------------------- flow animation (used by Home and the end-to-end lesson)

let flowToken = 0;
function stopFlow() { flowToken++; flowHead = -1; bus.glow.clear(); bus.flowing.clear(); }

/** Light the stations in order, as if the sound were travelling through the machine. */
async function flow(opts: { tour?: boolean; per?: number; onStation?: (id: string, i: number) => void } = {}) {
  const my = ++flowToken;
  const stops = ORDER.filter((id) => id !== "voice");
  const per = opts.per ?? 0.9;
  audio.playClip();
  for (let i = 0; i < stops.length; i++) {
    if (my !== flowToken) return false;
    const id = stops[i];
    bus.glow.set(id, 1);
    if (i > 0) bus.flowing.add(stops[i - 1]);
    if (opts.tour) world.focus([id], { fill: 0.42, dur: 0.8 });
    opts.onStation?.(id, i);
    const t0 = performance.now();
    while (performance.now() - t0 < per * 1000) {
      if (my !== flowToken) return false;
      if (id === "mel" || id === "tokens") flowHead = (performance.now() - t0) / (per * 1000);
      await new Promise((r) => setTimeout(r, 30));
    }
    flowHead = -1;
    bus.glow.set(id, 0.35);
  }
  return true;
}

// ---------------------------------------------------------------- sidebar flyouts

const flyout = $("flyout");
function openFlyout(kind: string | null, anchor?: HTMLElement) {
  document.querySelectorAll(".side-nav li").forEach((li) => li.classList.toggle("is-active", !!anchor && li.contains(anchor)));
  if (!kind || flyout.dataset.kind === kind) { flyout.classList.remove("is-open"); flyout.dataset.kind = ""; return; }
  flyout.dataset.kind = kind;
  flyout.innerHTML = "";
  if (kind === "lessons") {
    flyout.append(el("h3", {}, "Lessons"));
    let chap = "";
    COURSE.forEach((l, i) => {
      if (l.chapter !== chap) { chap = l.chapter; flyout.append(el("h4", {}, chap)); }
      const a = el("a", { href: `#${l.id}`, class: `${l === current ? "is-current" : ""}${done.has(l.id) ? " is-done" : ""}` }, el("span", {}, String(i + 1).padStart(2, "0")), l.title);
      a.addEventListener("click", () => openFlyout(null));
      flyout.append(a);
    });
  } else if (kind === "sounds") {
    flyout.append(el("h3", {}, "Sounds"), el("p", {}, "Every station shows the current sound. These seven are generated in your browser, sample by sample. You can also record yourself or upload a file."));
    for (const s of SPECIMENS) {
      const b = el("button", { type: "button", class: `fly-sound${audio.clip.id === s.id ? " is-current" : ""}` }, el("b", {}, s.name), el("small", {}, s.note));
      b.addEventListener("click", () => { audio.useSpecimen(s.id); audio.playClip(); openFlyout(null); });
      flyout.append(b);
    }
  } else if (kind === "settings") {
    flyout.append(el("h3", {}, "Settings"));
    const reset = el("button", { type: "button", class: "btn" }, "Reset progress");
    reset.addEventListener("click", () => { done.clear(); saveDone(); renderLessonList(); openFlyout(null); });
    const resetPipe = el("button", { type: "button", class: "btn" }, "Reset pipeline settings");
    resetPipe.addEventListener("click", () => { setPipe({ sr: 16000, bits: 16, winMs: 25, hopMs: 10, nMels: 80, encStride: 2, pool: 2 }); openFlyout(null); });
    flyout.append(el("p", {}, "Progress is saved in this browser only."), reset, el("p", {}, ""), resetPipe,
      el("p", { class: "fly-keys", html: "<b>Keys</b><br><kbd>Space</kbd> play · <kbd>R</kbd> run · <kbd>←</kbd> <kbd>→</kbd> lessons<br><kbd>Q</kbd> <kbd>E</kbd> turn · <kbd>+</kbd> <kbd>−</kbd> zoom · <kbd>0</kbd> reset view<br>Drag to pan, scroll to zoom." }));
  }
  flyout.classList.add("is-open");
}
document.querySelectorAll<HTMLAnchorElement>(".side-nav a").forEach((a) => {
  a.addEventListener("click", (e) => {
    const k = a.dataset.nav!;
    if (k === "home" || k === "voice") { openFlyout(null); return; }
    e.preventDefault();
    openFlyout(k, a);
  });
});
document.addEventListener("click", (e) => {
  if (!flyout.classList.contains("is-open")) return;
  const t = e.target as Element;
  if (!flyout.contains(t) && !t.closest?.(".sidebar")) openFlyout(null);
});

document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === " ") { e.preventDefault(); togglePlay(); }
  else if (k === "ArrowRight") step(1);
  else if (k === "ArrowLeft") step(-1);
  else if (k === "r" || k === "R") run();
  else if (k === "q" || k === "Q") world.rotate(-45);
  else if (k === "e" || k === "E") world.rotate(45);
  else if (k === "+" || k === "=") world.zoomBy(1.25);
  else if (k === "-") world.zoomBy(0.8);
  else if (k === "0") resetView();
  else if (k === "Escape") { openFlyout(null); closeScreen(); }
});

// ---------------------------------------------------------------- boot: build data and pictures behind the loader

(async () => {
  const fill = $("loader-fill"), stepEl = $("loader-step");
  const tick = (p: number, s: string) => new Promise<void>((r) => { fill.style.width = `${p * 100}%`; stepEl.textContent = s; requestAnimationFrame(() => setTimeout(r, 0)); });
  await document.fonts?.ready;
  await tick(0.1, "Synthesising sounds");
  SPECIMENS.forEach((s) => audio.specimen(s.id));
  await tick(0.3, "Training the codebooks");
  sharedBooks("all");
  labelLogits(audio.clip);
  await tick(0.55, "Listening to the first sound");
  reanalyse();
  await tick(0.7, "Drawing the lesson pictures");
  world.focus(ORDER, { instant: true });
  const keys = [...new Set(COURSE.map((l) => l.thumb.join(",")))];
  for (let i = 0; i < keys.length; i++) {
    thumbs.set(keys[i], world.thumbnail(keys[i].split(",")));
    if (i % 3 === 2) await tick(0.7 + (0.3 * i) / keys.length, "Drawing the lesson pictures");
  }
  renderViewbar();
  route();
  $("loader").classList.add("is-done");
  setTimeout(() => $("loader").remove(), 600);
})();

// test hook (development builds only): lets automated checks click 3D parts by name
if (import.meta.env.DEV) (window as unknown as { __hcl: unknown }).__hcl = { world, project: (sid: string, a: string) => world.project(world.stations.get(sid)!.anchors[a]) };
