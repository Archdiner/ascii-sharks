import type { AudioEngine } from "./audio/engine";

export const RAIL = ["Air", "Mic", "ADC", "Frames", "Mel", "Encoder", "Tokens", "Projector", "LM", "Head"] as const;

export type LogKind = "info" | "ok" | "warn" | "dim" | "head";

export interface Ctx {
  audio: AudioEngine;
  /** the stage area the lesson owns while mounted */
  root: HTMLElement;
  log: (text: string, kind?: LogKind) => void;
  /** jump to another lesson by id */
  go: (id: string) => void;
}

export interface Lesson {
  id: string;
  title: string;
  chapter: string;
  /** one line under the title on the stage */
  blurb: string;
  /** which rail stages light up */
  rail: number[];
  /** data rate at this point in the pipeline, for the status card */
  rate: { value: string; note: string };
  tabs: {
    overview: string;
    hood: string;
    lost: string;
    specs: [string, string][];
  };
  /** snippet shown in "Try it yourself" (Python, as you'd write it for real) */
  code: string;
  mount: (ctx: Ctx) => () => void;
  /** what the Run button does: the same computation, in the browser, on your audio */
  run: (ctx: Ctx) => void | Promise<void>;
  intro?: boolean;
}
