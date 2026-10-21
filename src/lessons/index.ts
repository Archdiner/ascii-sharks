import type { Lesson } from "../types";
import { intro } from "./intro";
import { sound, microphone, sampling, quantization } from "./capture";
import { frames, mel, lost } from "./represent";
import { encoder, tokens, projector } from "./encode";
import { layers, head } from "./understand";
import { mimi, moshi } from "./codecs";
import { richer, landscape } from "./beyond";

export const LESSONS: Lesson[] = [
  intro,
  sound, microphone, sampling, quantization,
  frames, mel, lost,
  encoder, tokens, projector,
  layers, head,
  mimi, moshi,
  richer, landscape,
];
