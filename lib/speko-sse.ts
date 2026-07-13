export interface ServerSentEvent {
  event: string;
  data: string;
}

export interface JsonServerSentEvent {
  event: string;
  data: Record<string, unknown>;
}

export function parseServerSentEvents(payload: string): ServerSentEvent[] {
  const normalized = payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized
    .split("\n\n")
    .map((block) => {
      let event = "message";
      const data: string[] = [];

      for (const line of block.split("\n")) {
        if (!line || line.startsWith(":")) {
          continue;
        }

        const separator = line.indexOf(":");
        const field = separator === -1 ? line : line.slice(0, separator);
        let value = separator === -1 ? "" : line.slice(separator + 1);
        if (value.startsWith(" ")) {
          value = value.slice(1);
        }

        if (field === "event") {
          event = value;
        } else if (field === "data") {
          data.push(value);
        }
      }

      return { event, data: data.join("\n") };
    })
    .filter((item) => item.data.length > 0);
}

export function parseJsonServerSentEvents(payload: string): JsonServerSentEvent[] {
  return parseServerSentEvents(payload)
    .filter((item) => item.data !== "[DONE]")
    .map((item) => {
      const parsed: unknown = JSON.parse(item.data);
      if (!isRecord(parsed)) {
        throw new Error(`SSE ${item.event} data was not an object`);
      }

      return { event: item.event, data: parsed };
    });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
