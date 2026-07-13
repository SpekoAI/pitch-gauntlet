import { describe, expect, test } from "bun:test";

import {
  parseJsonServerSentEvents,
  parseServerSentEvents,
} from "./speko-sse";

describe("parseServerSentEvents", () => {
  test("parses CRLF, comments, and multiline data", () => {
    const payload =
      ": keepalive\r\nevent: transcript\r\ndata: {\"text\":\r\ndata: \"hello\"}\r\n\r\n";

    expect(parseServerSentEvents(payload)).toEqual([
      { event: "transcript", data: '{"text":\n"hello"}' },
    ]);
  });

  test("uses the standard default event name", () => {
    expect(parseServerSentEvents('data: {"ok":true}\n\n')).toEqual([
      { event: "message", data: '{"ok":true}' },
    ]);
  });
});

describe("parseJsonServerSentEvents", () => {
  test("parses object data and skips a terminal sentinel", () => {
    const payload =
      'event: meta\ndata: {"provider":"test"}\n\nevent: done\ndata: [DONE]\n\n';

    expect(parseJsonServerSentEvents(payload)).toEqual([
      { event: "meta", data: { provider: "test" } },
    ]);
  });

  test("rejects invalid JSON and non-object data", () => {
    expect(() => parseJsonServerSentEvents("data: nope\n\n")).toThrow();
    expect(() => parseJsonServerSentEvents("data: []\n\n")).toThrow();
  });
});
