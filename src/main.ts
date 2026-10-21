import "./style.css";
import { audio } from "./audio/engine";
import { SPECIMENS } from "./audio/specimens";
import { el } from "./ui/dom";
import { highlight } from "./ui/code";
import { RAIL, type Ctx, type Lesson, type LogKind } from "./types";
import { LESSONS } from "./lessons";

const COURSE = LESSONS.filter((l) => !l.intro);
const STORE = "hcl-progress-v1";

function loadDone(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORE) ?? "[]")); } catch { return new Set(); }
}
function saveDone() {
  try { localStorage.setItem(STORE, JSON.stringify([...done])); } catch { /* private mode */ }
}
const done = loadDone();

const icon = (d: string, cls = "") => `<svg viewBox="0 0 32 32" class="${cls}" aria-hidden="true">${d}</svg>`;
const ICONS = {
  home: icon('<path d="M16 4.2 3.6 15.1c-.7.6-.3 1.7.6 1.7H6v9.4c0 1 .8 1.8 1.8 1.8h5.4v-7.3h5.6V28h5.4c1 0 1.8-.8 1.8-1.8v-9.4h1.8c.9 0 1.3-1.1.6-1.7z"/>', "fill"),
  lessons: icon('<path d="M16 9.2C13.4 7.3 9.6 6.6 5 6.8v17.6c4.6-.2 8.4.5 11 2.4 2.6-1.9 6.4-2.6 11-2.4V6.8c-4.6-.2-8.4.5-11 2.4zM16 9.2v17.6"/><path d="M3 9.4v17.4c5-.4 9.6.2 13 2.2 3.4-2 8-2.6 13-2.2V9.4"/>'),
  sounds: icon('<path d="M4 16h2M8 11v10M12 7v18M16 12v8M20 5v22M24 10v12M28 16h0"/>'),
  map: icon('<circle cx="7" cy="9" r="3"/><circle cx="25" cy="9" r="3"/><circle cx="16" cy="23" r="3"/><path d="M10 9h12M8.5 11.6 14 20.5M23.5 11.6 18 20.5"/>'),
  settings: icon('<path d="M18.3 3.5h-4.6l-.7 3.4a9.7 9.7 0 0 0-2.6 1.5L7.1 7.3 4.8 11.2l2.6 2.3a9.9 9.9 0 0 0 0 3l-2.6 2.3 2.3 3.9 3.3-1.1c.8.6 1.7 1.1 2.6 1.5l.7 3.4h4.6l.7-3.4c.9-.4 1.8-.9 2.6-1.5l3.3 1.1 2.3-3.9-2.6-2.3a9.9 9.9 0 0 0 0-3l2.6-2.3-2.3-3.9-3.3 1.1c-.8-.6-1.7-1.1-2.6-1.5zM16 11.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6z"/>', "fill"),
};
const LOGO = `<svg class="brand-logo" viewBox="0 0 92 50" aria-hidden="true"><path class="loop" d="M4 25h8l4-12 6 26 6-34 6 38 6-30 6 20 4-8h8"/><path class="sign" d="M66 13c8 0 14 5 14 12s-6 12-14 12M70 19c4 0 6 3 6 6s-2 6-6 6"/></svg>`;

// ---------------------------------------------------------------- layout

const app = document.getElementById("app")!;
app.innerHTML = `
  <nav class="sidebar" aria-label="Main">
    <ul class="side-nav">
      <li><a href="#intro" data-nav="home" title="Home">${ICONS.home}<span class="side-label">Home</span></a></li>
      <li><a href="#" data-nav="lessons" title="Lessons">${ICONS.lessons}<span class="side-label">Lessons</span></a></li>
      <li><a href="#" data-nav="sounds" title="Sounds">${ICONS.sounds}<span class="side-label">Sounds</span></a></li>
      <li><a href="#landscape" data-nav="map" title="Landscape">${ICONS.map}<span class="side-label">Landscape</span></a></li>
      <li class="is-muted"><a href="#" data-nav="settings" title="Settings">${ICONS.settings}<span class="side-label">Settings</span></a></li>
    </ul>
  </nav>
  <aside class="flyout" id="flyout" aria-live="polite"></aside>

  <header class="brand">
    ${LOGO}
    <span class="brand-rule" aria-hidden="true"></span>
    <div class="brand-text">
      <h1>How Computers Listen</h1>
      <p>Capture <i>·</i> Represent <i>·</i> Understand</p>
    </div>
  </header>

  <section class="status" aria-label="Progress">
    <div class="progress-card">
      ${ICONS.lessons.replace('class=""', 'class="progress-icon"')}
      <div class="progress-body">
        <span class="progress-label" id="progress-label">Capture</span>
        <div class="progress-row">
          <span class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${COURSE.length}" id="progress-bar"><span class="progress-fill" id="progress-fill"></span></span>
          <span class="progress-count" id="progress-count">0/${COURSE.length}</span>
        </div>
      </div>
    </div>
    <div class="rate-card" title="How much data flows through this point in the pipeline">
      <span class="rate-label">Data rate here</span>
      <b id="rate-value">—</b>
      <small id="rate-note"></small>
    </div>
    <time class="clock" id="clock"><span id="clock-date"></span><span id="clock-time"></span></time>
  </section>

  <main class="stage" id="stage">
    <ol class="rail" id="rail" aria-label="Pipeline"></ol>
    <div class="stage-head">
      <span class="kicker" id="kicker"></span>
      <h2 id="lesson-title"></h2>
      <p id="lesson-blurb"></p>
    </div>
    <div class="viz" id="viz"></div>
    <div class="viewbar" id="viewbar" role="toolbar" aria-label="Audio source"></div>
  </main>

  <section class="info-card" aria-label="Lesson information">
    <div class="tabs" role="tablist" id="tabs"></div>
    <div class="info-body" role="tabpanel" id="info-body"></div>
    <div class="info-foot">
      <button class="btn-ghost" id="prev" type="button" aria-label="Previous lesson">← Prev</button>
      <button class="btn-next" id="next" type="button">Next lesson →</button>
    </div>
  </section>

  <section class="code-card" aria-label="Try it yourself" data-state="idle" id="code-card">
    <header>
      <h2>Try it yourself</h2>
      <div class="code-actions">
        <button class="btn-ghost btn-copy" id="copy" aria-label="Copy code" title="Copy code">
          <svg viewBox="0 0 24 24"><rect x="8" y="8" width="11.5" height="12.5" rx="1.6"/><path d="M15.5 5.2V4.8c0-.9-.7-1.6-1.6-1.6H6.1c-.9 0-1.6.7-1.6 1.6v9.6c0 .9.7 1.6 1.6 1.6h.4"/></svg>
        </button>
        <button class="btn-run" id="run" aria-label="Run on your audio" title="Run on your audio (R)">
          <svg viewBox="0 0 24 24"><path d="M7.5 4.8v14.4L19 12z" class="fill"/></svg>
        </button>
      </div>
    </header>
    <div class="code-wrap">
      <pre class="code"><code id="code"></code></pre>
      <div class="console">
        <div class="console-head">
          <span class="console-dot"></span>
          <span class="console-title">Signal monitor</span>
          <span class="console-status" id="console-status">Stopped</span>
          <button class="console-close" id="console-clear" aria-label="Clear monitor" title="Clear">
            <svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>
          </button>
        </div>
        <div class="console-lines" id="console" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section class="lessons" aria-label="Lessons">
    <h2>Lessons</h2>
    <ol class="lesson-list" id="lesson-list"></ol>
  </section>
`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viz = $("viz");
const consoleEl = $("console");
const codeCard = $("code-card");

// ---------------------------------------------------------------- console

function log(text: string, kind: LogKind = "info") {
  const now = new Date();
  const ts = `${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.${String(Math.floor(now.getMilliseconds() / 10)).padStart(2, "0")}`;
  const line = el("div", { class: `cl cl-${kind}` }, el("span", { class: "ts" }, ts), el("span", { class: "tx" }, text));
  consoleEl.append(line);
  while (consoleEl.children.length > 200) consoleEl.firstChild?.remove();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
$("console-clear").addEventListener("click", () => { consoleEl.innerHTML = ""; setRunState("idle"); });

function setRunState(s: "idle" | "running" | "done") {
  codeCard.dataset.state = s;
  $("console-status").textContent = s === "running" ? "Running" : s === "done" ? "Done" : "Stopped";
}

// ---------------------------------------------------------------- lessons

let current: Lesson = LESSONS[0];
let unmount: (() => void) | null = null;
let activeTab: keyof Lesson["tabs"] = "overview";

const ctx: Ctx = { audio, root: viz, log, go: (id) => go(id) };

function renderRail(l: Lesson) {
  $("rail").innerHTML = RAIL.map((name, i) => `<li class="${l.rail.includes(i) ? "is-on" : ""}${l.rail.length && i < Math.min(...l.rail) ? " is-past" : ""}"><span>${name}</span></li>`).join("");
}

const TAB_NAMES: [keyof Lesson["tabs"], string][] = [["overview", "Overview"], ["hood", "Under the hood"], ["lost", "What's lost"], ["specs", "Specs"]];

function renderTabs() {
  const tabs = $("tabs");
  tabs.innerHTML = "";
  for (const [k, name] of TAB_NAMES) {
    const b = el("button", { role: "tab", type: "button", class: k === activeTab ? "is-active" : "", "aria-selected": String(k === activeTab) }, name);
    if (k === "lost") b.classList.add("tab-lost");
    b.addEventListener("click", () => { activeTab = k; renderTabs(); });
    tabs.append(b);
  }
  const body = $("info-body");
  if (activeTab === "specs") {
    body.innerHTML = `<dl class="specs">${current.tabs.specs.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join("")}</dl>`;
  } else {
    body.innerHTML = current.tabs[activeTab];
  }
  body.querySelectorAll<HTMLAnchorElement>("a[data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.go!); }));
  body.scrollTop = 0;
}

function renderLessonList() {
  const list = $("lesson-list");
  list.innerHTML = "";
  COURSE.forEach((l, i) => {
    const li = el("li", { class: `${l === current ? "is-current" : ""}${done.has(l.id) ? " is-done" : ""}` });
    const a = el("a", { href: `#${l.id}` },
      el("span", { class: "lesson-num" }, String(i + 1).padStart(2, "0")),
      el("span", { class: "lesson-meta" }, el("small", {}, l.chapter), el("b", {}, l.title)),
      el("span", { class: "lesson-check", "aria-label": done.has(l.id) ? "done" : "" }),
    );
    li.append(a);
    list.append(li);
  });
  list.querySelector(".is-current")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  const n = COURSE.filter((l) => done.has(l.id)).length;
  $("progress-count").textContent = `${n}/${COURSE.length}`;
  $("progress-fill").style.width = `${(n / COURSE.length) * 100}%`;
  $("progress-bar").setAttribute("aria-valuenow", String(n));
}

function markDone(l: Lesson) {
  if (l.intro || done.has(l.id)) return;
  done.add(l.id);
  saveDone();
  renderLessonList();
}

function show(l: Lesson) {
  unmount?.();
  unmount = null;
  audio.stop();
  current = l;
  activeTab = "overview";
  viz.innerHTML = "";
  viz.dataset.lesson = l.id;
  const idx = COURSE.indexOf(l);
  $("kicker").textContent = l.intro ? "Start here" : `Lesson ${idx + 1} · ${l.chapter}`;
  $("lesson-title").textContent = l.title;
  $("lesson-blurb").textContent = l.blurb;
  $("progress-label").textContent = l.intro ? "Course" : l.chapter;
  $("rate-value").textContent = l.rate.value;
  $("rate-note").textContent = l.rate.note;
  $("code").innerHTML = highlight(l.code);
  (($("prev") as HTMLButtonElement).disabled = l === LESSONS[0]);
  $("next").textContent = idx === COURSE.length - 1 ? "Back to start ↺" : l.intro ? "Start lesson 1 →" : "Next lesson →";
  renderRail(l);
  renderTabs();
  renderLessonList();
  consoleEl.innerHTML = "";
  setRunState("idle");
  log(`${l.intro ? "Ready" : `Lesson ${idx + 1}`}: ${l.title}. Press ▶ to run the code on your audio.`, "dim");
  unmount = l.mount(ctx);
  document.title = l.intro ? "How Computers Listen" : `${l.title} · How Computers Listen`;
}

function go(id: string) {
  if (location.hash.slice(1) !== id) location.hash = id;
  else route();
}

function route() {
  const id = location.hash.slice(1);
  const l = LESSONS.find((x) => x.id === id) ?? LESSONS[0];
  if (l !== current || !unmount) show(l);
}
window.addEventListener("hashchange", route);

function step(d: number) {
  const i = LESSONS.indexOf(current);
  if (d > 0) markDone(current);
  const j = i + d;
  go((LESSONS[j] ?? LESSONS[d > 0 ? 0 : i]).id);
}
$("next").addEventListener("click", () => step(1));
$("prev").addEventListener("click", () => step(-1));

async function run() {
  if (codeCard.dataset.state === "running") return;
  setRunState("running");
  const l = current;
  log(`$ run ${l.id}.py`, "head");
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
  try { await navigator.clipboard.writeText(current.code); log("Copied snippet to clipboard.", "dim"); } catch { log("Clipboard not available here.", "warn"); }
});

// ---------------------------------------------------------------- source bar

const viewbar = $("viewbar");
function renderViewbar() {
  const c = audio.clip;
  const playing = audio.playing === "clip";
  viewbar.innerHTML = "";
  const sel = el("select", { class: "src-select", "aria-label": "Sound" },
    ...SPECIMENS.map((s) => el("option", { value: s.id, selected: c.id === s.id }, s.name)),
    c.source !== "specimen" ? el("option", { value: c.id, selected: true }, c.name) : null,
  );
  sel.addEventListener("change", () => audio.useSpecimen(sel.value));
  const play = el("button", { type: "button", class: `vb-btn vb-play${playing ? " is-on" : ""}`, title: "Play / stop the clip (Space)", "aria-label": playing ? "Stop clip" : "Play clip" },
    el("span", { html: playing ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1" class="fill"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5.5v13L18.5 12z" class="fill"/></svg>' }), playing ? "Stop" : "Play");
  play.addEventListener("click", togglePlay);
  const mic = el("button", { type: "button", class: `vb-btn${audio.micOn ? " is-live" : ""}`, title: "Listen to your microphone live" },
    el("span", { html: '<svg viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>' }), audio.micOn ? "Mic live" : "Mic");
  mic.addEventListener("click", async () => {
    try { audio.micOn ? audio.stopMic() : await audio.startMic(); } catch { log("Microphone permission was denied or unavailable.", "warn"); }
  });
  const rec = el("button", { type: "button", class: "vb-btn", title: "Record 4 seconds and make it the clip" },
    el("span", { html: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.5" class="fill rec"/></svg>' }), "Record 4 s");
  rec.addEventListener("click", async () => {
    rec.disabled = true;
    try {
      log("Recording 4 s from your microphone… say something, clap, whistle.", "info");
      await audio.record(4, (t) => { rec.lastChild!.textContent = `${Math.max(0, 4 - t).toFixed(1)} s`; });
      log("Recorded. Your voice is now the clip every lesson uses.", "ok");
    } catch { log("Microphone permission was denied or unavailable.", "warn"); rec.disabled = false; renderViewbar(); }
  });
  const file = el("input", { type: "file", accept: "audio/*", class: "sr-only", id: "file-in" });
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try { await audio.loadFile(f); log(`Loaded "${f.name}" (first 6 s).`, "ok"); } catch { log("Couldn't decode that file.", "warn"); }
  });
  const up = el("label", { class: "vb-btn", for: "file-in", title: "Use your own audio file" },
    el("span", { html: '<svg viewBox="0 0 24 24"><path d="M12 16V5M7.5 9.5 12 5l4.5 4.5M5 19h14"/></svg>' }), "Upload");
  const meta = el("span", { class: "vb-meta" }, `${c.name} · ${audio.duration.toFixed(1)} s · ${(c.sr / 1000).toFixed(1)} kHz · ${c.channels[0] === c.channels[1] ? "mono" : "stereo"}`);
  viewbar.append(el("span", { class: "vb-label" }, "Sound"), sel, play, el("span", { class: "viewbar-sep" }), mic, rec, up, file, meta);
}
function togglePlay() {
  if (audio.playing) audio.stop();
  else audio.playClip();
}
audio.on(renderViewbar);
renderViewbar();

// ---------------------------------------------------------------- flyouts (sidebar)

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
    flyout.append(el("h3", {}, "Sounds"), el("p", {}, "Every lesson runs on the current clip. These are synthesised in your browser, sample by sample. Or use the mic, record yourself, or upload a file."));
    for (const s of SPECIMENS) {
      const b = el("button", { type: "button", class: `fly-sound${audio.clip.id === s.id ? " is-current" : ""}` }, el("b", {}, s.name), el("small", {}, s.note));
      b.addEventListener("click", () => { audio.useSpecimen(s.id); audio.playClip(); openFlyout(null); });
      flyout.append(b);
    }
  } else if (kind === "settings") {
    flyout.append(el("h3", {}, "Settings"));
    const reset = el("button", { type: "button", class: "btn" }, "Reset progress");
    reset.addEventListener("click", () => { done.clear(); saveDone(); renderLessonList(); openFlyout(null); log("Progress reset.", "dim"); });
    flyout.append(el("p", {}, "Progress is kept in this browser only."), reset,
      el("p", { class: "fly-keys", html: "<b>Keys</b><br><kbd>Space</kbd> play / stop · <kbd>R</kbd> run · <kbd>←</kbd> <kbd>→</kbd> lessons" }));
  }
  flyout.classList.add("is-open");
}
document.querySelectorAll<HTMLAnchorElement>(".side-nav a").forEach((a) => {
  a.addEventListener("click", (e) => {
    const k = a.dataset.nav!;
    if (k === "home" || k === "map") { openFlyout(null); return; }
    e.preventDefault();
    openFlyout(k, a);
  });
});
document.addEventListener("click", (e) => {
  if (!flyout.classList.contains("is-open")) return;
  const t = e.target as Node;
  if (!flyout.contains(t) && !(t as Element).closest?.(".sidebar")) openFlyout(null);
});

// ---------------------------------------------------------------- keys & clock

document.addEventListener("keydown", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === " ") { e.preventDefault(); togglePlay(); }
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
  else if (e.key === "r" || e.key === "R") run();
  else if (e.key === "Escape") openFlyout(null);
});

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function tickClock() {
  const d = new Date();
  $("clock-date").textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  $("clock-time").textContent = d.toTimeString().slice(0, 8);
}
tickClock();
setInterval(tickClock, 1000);

route();
