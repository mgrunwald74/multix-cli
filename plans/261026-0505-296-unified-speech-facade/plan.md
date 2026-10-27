# Unified speech (TTS) façade (issue #296)

Status: implemented, in review

## Outcome

- `multix speech models [-p] [-l] [--ready]` lists every TTS model the façade
  routes to, with languages, language param, formats, style, emotions,
  max speakers, async, voice kind/default, provider extras, billing, source
  and `verified_at`.
- `multix speech generate --provider <p> [--model]` takes one request
  (`multix.speech.request/v1`: text or text file, voice or speakers, language,
  style, emotion, format, output, async, `--extra <provider>.<key>=<value>`)
  and runs it on exactly that provider/model through the provider's existing
  generator. `--json` returns `multix.result/v1` whose `data` is
  `multix.speech.result/v1` (text hashed, never echoed; route; fallback).
- Remote MCP (`multix_run`): the job gets only the keys of the routed
  providers; `--text-file` is an `inputs` URL.

## Constraints and non-goals

- No silent provider switching. A model without `--provider` is inferred only
  when exactly one provider serves it. `--fallback` is opt-in, applies only when
  an earlier route has no key (before any request), and its warning lists
  voice/model/billing differences. A paid request is never retried.
- Every route is validated before the first request; `--dry-run` sends nothing.
- Existing provider commands unchanged (MiniMax `generate-speech` keeps its
  `--emotion neutral` default).
- No new provider clients: OpenRouter (#290), fal (#291), ElevenLabs v4 (#292)
  plug in later as one adapter + catalog rows; #293 may later own the table.

## Design

| Concern | Choice |
|---|---|
| Capability data | `src/speech/speech-catalog.ts` (runtime-neutral, cited per provider) |
| Request/validation | `src/speech/speech-request.ts`, all problems in one `ValidationError` |
| Provider calls | `src/commands/speech/speech-adapters.ts`, one adapter per provider |
| Async | Atlas `--async` returns `{job: {id, resume}}` via `resumeCommand` |
| Envelope data | `run.data` (new) wins over parsed stdout |
| Worker keys | `CommandPolicy.keyOptions` → `PreparedRun.keyGroups` → `jobEnv(groups)` |

## Acceptance criteria

- Offline fixtures for 3+ providers: unsupported emotion, voice mismatch,
  missing key, async return, paid no-retry.
- Client, CLI and worker tests with mocked fetch; deterministic hashes and
  model provenance in the envelope.
- `npm run lint`, `typecheck`, `build`, `test`, `check:mcp`, `verify:docs` green.
- Docs: README, docs-site EN/VI, `skill/SKILL.md` with Vietnamese dialogue.

## Follow-ups

- #307 MiniMax pcm extension (fixed here), #309 dev/main divergence.
