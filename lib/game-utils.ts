const STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "for",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "will",
  "would",
  "could",
  "should",
  "our",
  "your",
  "their",
  "its",
  "is",
  "it",
  "we",
  "you",
  "they",
  "them",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "why",
  "not",
  "but",
  "just",
  "really",
  "very",
  "going",
  "gonna",
  "about",
  "there",
  "here",
  "because",
  "people",
  "thing",
  "things",
  "want",
  "need",
  "make",
  "makes",
  "more",
  "than",
  "then",
  "into",
  "from",
  "also",
  "been",
  "being",
  "can",
  "cant",
  "dont",
  "doesnt",
  "um",
  "uh",
  "like",
  "know",
  "yeah",
  "kind",
  "sort",
  "okay",
  "actually",
  "basically",
  "literally",
]);

export interface RepeatedWord {
  word: string;
  count: number;
}

/**
 * Finds the most-repeated meaningful word in the transcript (>= minCount
 * occurrences, >= 4 chars, not a stopword). Used to slot-fill live
 * synthesized interjections.
 */
export function findRepeatedWord(
  transcript: string,
  minCount = 3,
): RepeatedWord | null {
  const words = transcript
    .toLowerCase()
    .match(/[a-z]+(?:'[a-z]+)*/g);
  if (!words) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const word of words) {
    if (word.length < 4 || STOPWORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  let best: RepeatedWord | null = null;
  for (const [word, count] of counts) {
    if (count >= minCount && (!best || count > best.count)) {
      best = { word, count };
    }
  }
  return best;
}

export interface ComebackSegment {
  text: string;
  durationMs: number;
}

/**
 * The "best comeback" is the longest uninterrupted stretch: given transcript
 * snapshots taken at each interruption (plus the final transcript), returns
 * the longest segment between interruptions by word count.
 */
export function bestComeback(
  snapshots: readonly string[],
  timestampsMs: readonly number[],
  finalTranscript: string,
  endMs: number,
): ComebackSegment | null {
  const texts = [...snapshots, finalTranscript];
  const times = [0, ...timestampsMs, endMs];
  let best: ComebackSegment | null = null;
  let previous = "";
  for (let i = 0; i < texts.length; i += 1) {
    const current = texts[i] ?? "";
    const segmentText = current.slice(previous.length).trim();
    const words = segmentText.split(/\s+/).filter(Boolean).length;
    const durationMs = Math.max(0, (times[i + 1] ?? endMs) - (times[i] ?? 0));
    if (segmentText.length > 0) {
      if (
        !best ||
        words > best.text.split(/\s+/).filter(Boolean).length
      ) {
        best = {
          text:
            segmentText.length > 200
              ? `${segmentText.slice(0, 197)}...`
              : segmentText,
          durationMs,
        };
      }
    }
    previous = current;
  }
  return best;
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
