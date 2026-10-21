import type { AudioEngine } from "./audio/engine";
import type { World } from "./scene/world";
import type { Draw } from "./scene/screen";
import type { Slot } from "./ui/callouts";
import type { Pipe } from "./pipeline";
import type { Analysis } from "./analysis";

export type LogKind = "info" | "ok" | "warn" | "dim" | "head";

/** A label card pointing at a part of the machine. `at` is "station.anchor". */
export interface Callout {
  at: string;
  icon: string;
  title: string;
  text: string;
  slot?: Slot;
  value?: () => string;
}

export interface Row {
  el: HTMLElement;
  /** replace the row's text */
  text: (html: string) => void;
}

export interface Ctx {
  audio: AudioEngine;
  world: World;
  log: (text: string, kind?: LogKind) => void;
  go: (id: string) => void;
  /** add an interactive row (icon, explanation, optional control) to the Overview tab */
  row: (icon: string, html: string, control?: Node | null) => Row;
  /** add a live readout */
  stat: (label: string, cls?: string) => { set: (value: string) => void };
  /** draw into a station's monitor; `primary` makes it the one the ⤢ button enlarges */
  screen: (station: string, draw: Draw | null, opts?: { primary?: boolean; key?: string }) => void;
  /** make a station clickable while this lesson is open */
  click: (station: string, fn: ((part: string) => void) | null, hint?: (part: string) => string | null) => void;
  callouts: (list: Callout[]) => void;
  focus: (ids: string[], opts?: { fill?: number; yaw?: number; offset?: [number, number] }) => void;
  pipe: () => Pipe;
  setPipe: (patch: Partial<Pipe>) => void;
  /** the current clip run through the current pipeline settings */
  analysis: () => Analysis;
  /** called whenever the clip or the pipeline settings change */
  onChange: (fn: () => void) => void;
  /** animate the sound travelling through the machine; resolves false if interrupted */
  flow: (opts?: { tour?: boolean; per?: number; onStation?: (id: string, i: number) => void }) => Promise<boolean>;
  stopFlow: () => void;
  /** open the lesson's main monitor full size */
  expand: () => void;
  /** small numbered tags floating over stations (Home view) */
  setTags: (tags: { station: string; label: string; num: number; lit?: boolean; onClick: () => void }[]) => void;
}

export interface Lesson {
  id: string;
  title: string;
  /** a few words for the lesson strip */
  short: string;
  chapter: string;
  /** stations to render for the lesson-strip picture */
  thumb: string[];
  /** stations the camera frames */
  focus: string[];
  view?: { fill?: number; yaw?: number; offset?: [number, number] };
  callouts: Callout[];
  /** two or three plain sentences under the title */
  summary: string;
  /** "How it works", numbered */
  steps: string[];
  /** "What's lost" (HTML) */
  lost: string;
  /** terms introduced in this lesson, defined for a first-time reader */
  words: [string, string][];
  specs: [string, string][];
  /** Python you could run yourself */
  code: string;
  rate: (p: Pipe) => { value: string; note: string };
  mount: (ctx: Ctx) => void | (() => void);
  /** what the ▶ button does: the same computation, in the browser, on the current sound */
  run: (ctx: Ctx) => void | Promise<void>;
  intro?: boolean;
}
