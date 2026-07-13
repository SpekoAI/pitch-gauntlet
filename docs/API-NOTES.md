# Speko API Notes

Validated against the configured API on 2026-07-12. These notes describe the
observed wire behavior. They take precedence over assumptions based on older
documentation.

## Authentication and base URL

- Base URL is supplied by `SPEKO_API_BASE`.
- Requests use `Authorization: Bearer $SPEKO_API_KEY`.
- Secrets remain in `.env.local`, which is ignored by Git.

## Synthesis

`POST /v1/synthesize` accepts JSON in this shape:

```json
{
  "text": "A short line to synthesize.",
  "intent": {
    "language": "en",
    "useCase": "conversational"
  },
  "voice": {
    "vendor": "provider-name",
    "id": "provider-voice-id",
    "name": "Provider voice name"
  }
}
```

The `voice` field is optional. `intent.language` is required; omitting it was
observed to return HTTP 400.

The supplied live-testing baseline accepted a full voice object from
`/v1/voices`. During the repository batch run on 2026-07-12, that same shape
returned HTTP 400 with `voice must be a string`. Sending the selected voice
`id`, such as `onyx`, succeeded. Sending `vendor:id`, such as `openai:onyx`,
was treated as a literal voice id and failed across providers. The prebake
utility first tries the documented object shape and falls back to `id` only for
this specific validation error so it remains compatible with both behaviors.

The response body is raw mono, signed 16-bit PCM. Important response headers:

- `x-speko-audio-format`, observed as values such as `audio/pcm;rate=24000`
- `x-speko-first-byte-ms`, the service-measured first-byte latency
- `x-speko-provider`
- `x-speko-model`

Raw PCM is not directly browser-playable. The application parses the sample
rate from `x-speko-audio-format` and adds a 44-byte RIFF/WAVE header before
returning or saving audio.

Initial live testing reported about 1.0 to 1.2 seconds total for a 10 to 15 word
line and about 170 ms to first byte. Repository generation measurements are
recorded below after the full placeholder batch is produced.

## Voices

`GET /v1/voices` returns JSON shaped as:

```json
{
  "providers": [],
  "voices": [
    {
      "vendor": "provider-name",
      "id": "provider-voice-id",
      "name": "Provider voice name"
    }
  ]
}
```

The repository run found 108 voices across 23 providers, including OpenAI,
Cartesia, and ElevenLabs. The request completed in 266 ms. See the synthesis
wire-drift note above before passing a returned voice to synthesis.

## Transcription

`POST /v1/transcribe` uses:

- `Content-Type: application/octet-stream`
- `Authorization: Bearer $SPEKO_API_KEY`
- `x-speko-intent: {"language":"en"}`
- The encoded audio bytes as the request body

The response is an SSE stream with these observed events:

- `meta`, containing provider and model metadata
- `transcript`, containing `{text,isFinal,confidence}`
- `done`, containing the final text and related metadata

No word-level timestamps are provided. Initial live testing transcribed an
approximately 7 second chunk in about 1.5 seconds. A repository verification
measurement is recorded below after a generated fixture is sent.

## Completion

`POST /v1/complete` was probed on 2026-07-12 with two request shapes.

The prompt-only shape returned HTTP 400:

```json
{
  "prompt": "Reply with exactly: probe ok",
  "intent": {
    "language": "en",
    "useCase": "conversational"
  }
}
```

The error identified `messages` as a required array.

The messages shape returned HTTP 200:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Reply with exactly: probe ok"
    }
  ],
  "intent": {
    "language": "en",
    "useCase": "conversational"
  }
}
```

The response is `text/event-stream`, not a single JSON object. The observed
sequence was:

```text
event: meta
data: {"provider":"cerebras","model":"gpt-oss-120b",...}

event: delta
data: {"text":"probe ok"}

event: done
data: {"text":"probe ok","provider":"cerebras","model":"gpt-oss-120b","usage":{...},...}
```

The successful probe completed in about 1.1 seconds including both attempted
requests. The working route should parse the `done` event as authoritative and
may accumulate `delta` text as a fallback.

## Repository run measurements

The placeholder prebake run generated all 24 files with three concurrent
workers. Every output was verified as RIFF/WAVE, mono, signed 16-bit PCM at
24 kHz.

Synthesis measurements across the 24 generated lines:

- Service first-byte header: 482.6 ms average, 277 ms median
- Service first-byte range: 124 to 1909 ms
- End-to-end synthesis and file-write time: 2443.9 ms average, 2263 ms median
- End-to-end range: 1335 to 4150 ms

The run selected these placeholder voice ids from `/v1/voices`:

- skeptic: Onyx, `openai:onyx`
- spreadsheet: Nova, `openai:nova`
- vibes: Echo, `openai:echo`

The wider tail came from provider failover. A separate short `onyx` probe
reported 2181 ms to first byte, seven failovers, and ultimately used MiniMax
`speech-2.6-turbo`.

For transcription verification, one generated 3.8545 second WAV was sent to
`/v1/transcribe`:

- HTTP status: 200
- Time to first response byte: 948 ms
- Total response time: 1148 ms
- Provider and model: Cartesia `ink-2`
- Final confidence: 1
- Events: one `meta`, two final `transcript` events, and one `done`

## Application proxy contracts

`POST /api/stt-chunk` requires `Content-Type: application/octet-stream` and an
`x-audio-duration-ms` header between 1 and 15000. The body is limited to 4 MiB.
The JSON response is `{text, confidence, msElapsed}`.

`POST /api/synth` accepts exactly one of these allowlisted modes:

- `{lineId}` where `lineId` is one of the 24 manifest ids
- `{templateId, slots}` where the template and exact slot names are allowlisted

Slots are sanitized, limited to six alphanumeric word runs, and checked against
a local profanity list. Unsupported fields, including raw `text` and `voice`,
are rejected before the speech service is called. The route returns WAV audio
and passes through Speko first-byte, provider, and model headers.

`POST /api/roast` accepts a bounded transcript and one of the three persona ids.
It uses the verified completion SSE wire format, bounds and filters model
output, and never calls TTS. Dynamic output is not accepted by `/api/synth`.
