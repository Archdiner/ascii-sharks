import type { Lesson } from "../types";
import { start } from "./start";
import { sound, microphone, sampling, bits } from "./capture";
import { spectrum, mel, lost } from "./represent";
import { encoder, tokens, projector } from "./encode";
import { attention, headLesson } from "./understand";
import { mimi, moshi } from "./talk";
import { beyond, field, journey } from "./beyond";

export const LESSONS: Lesson[] = [
  start,
  sound, microphone, sampling, bits,
  spectrum, mel, lost,
  encoder, tokens, projector,
  attention, headLesson,
  mimi, moshi,
  beyond, field, journey,
];
