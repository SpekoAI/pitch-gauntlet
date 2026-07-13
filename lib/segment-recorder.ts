/**
 * Records the mic in complete, independently-decodable segments by
 * restarting MediaRecorder on an interval. Chunked timeslice blobs from a
 * single MediaRecorder are NOT standalone files (only the first carries the
 * container header), so each segment gets its own recorder lifecycle.
 */
export interface SegmentRecorderOptions {
  segmentMs: number;
  onSegment: (blob: Blob) => void;
  mimeType?: string;
}

export interface SegmentRecorder {
  stop: () => void;
  mimeType: string;
}

export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
}

export function startSegmentRecorder(
  stream: MediaStream,
  options: SegmentRecorderOptions,
): SegmentRecorder {
  const mimeType = options.mimeType ?? pickAudioMimeType();
  let stopped = false;
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function startOne(): void {
    if (stopped) {
      return;
    }
    const parts: BlobPart[] = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        parts.push(event.data);
      }
    };
    recorder.onstop = () => {
      if (parts.length > 0) {
        options.onSegment(new Blob(parts, { type: mimeType }));
      }
      startOne();
    };
    recorder.start();
    timer = setTimeout(() => {
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      }
    }, options.segmentMs);
  }

  startOne();

  return {
    mimeType,
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      }
    },
  };
}
