import type { JsonServerSentEvent } from "./speko-sse";

export interface TranscriptionResult {
  text: string;
  confidence: number | null;
}

export function extractTranscription(
  events: JsonServerSentEvent[],
): TranscriptionResult {
  let latestText = "";
  let latestConfidence: number | null = null;
  let doneText: string | null = null;
  let doneConfidence: number | null = null;

  for (const item of events) {
    if (item.event !== "transcript" && item.event !== "done") {
      continue;
    }

    const text = typeof item.data.text === "string" ? item.data.text.trim() : "";
    const confidence = finiteNumber(item.data.confidence);

    if (item.event === "done") {
      if (text) {
        doneText = text;
      }
      if (confidence !== null) {
        doneConfidence = confidence;
      }
    } else {
      if (text) {
        latestText = text;
      }
      if (confidence !== null) {
        latestConfidence = confidence;
      }
    }
  }

  return {
    text: doneText ?? latestText,
    confidence: doneConfidence ?? latestConfidence,
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
