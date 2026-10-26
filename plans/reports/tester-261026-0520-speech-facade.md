# Tester report: `multix speech` façade (#296)

## Outcome

All gates pass: build, targeted speech tests, full `npm test`, lint, typecheck, and `npm run check:mcp`. The suite covers the speech façade offline. Three `it.fails` cases document real defects in `src/` that were not fixed here, per scope. No `src/`, `worker/src/`, or docs files were edited.

## Tests added

| File | Tests | Covers |
|---|---|---|
| `tests/speech/speech-request.test.ts` | ~59 | Contract fixtures across gemini, openai, elevenlabs, minimax; voice and language rules; routing; fallback planning; `parseRouteSpec`; `fallbackDifferences`; `collectExtra` and `collectSpeaker`; `resolveFormat` |
| `tests/speech/speech-adapters.test.ts` | ~30 | Adapters with mocked fetch: request bodies and URLs, deterministic output, provenance, elevenlabs payload, minimax pcm, atlas async envelope, no retry on provider 500, `requireKey` sends nothing |
| `tests/speech/speech-command.test.ts` | 17 (+2 `it.fails`) | In-process `speech generate`: fallback only on missing key, validation before any request, provenance and sha256, `--text-file`, async submission |
| `tests/smoke/speech-cli.test.ts` | 18 | `dist/cli.js` via execa: `speech models` filters and readiness, dry runs that send nothing, `--json` error codes and exit classes |
| `worker/test/run-argv-builder.test.ts` | +speech block | `prepareRun` for speech: provider required, `keyGroups`, non-speech provider rejection, `--text-file` handling, repeated `--extra`, `speech models` |
| `worker/test/job-env.test.ts` | 5 | `jobEnv` passes only named group keys, trimmed, and drops blanks |

Test helper: `tests/speech/speech-test-helpers.ts`. Fetch is mocked and every unexpected request throws. Dry runs use a dead proxy.

## Command results

- `npm run build`: success (dist built, DTS built).
- `npx vitest run tests/speech tests/smoke/speech-cli.test.ts`: 4 files passed. 116 tests passed, 3 expected-fail.
- `npm test`: 93 files passed, 4 skipped. 1628 tests passed, 3 expected-fail, 12 skipped. Duration about 21 s.
- `npm run lint`: clean, 494 files checked.
- `npm run typecheck`: clean.
- `npm run check:mcp`: worker tests 387 passed. Bundle check clean: no `node:*`, commander, execa, or CLI imports. Targeted worker run of the two changed worker test files: 62 passed.

## Known defects (documented by `it.fails`)

1. **tts-1 default voice is invalid.** `src/speech/speech-catalog.ts` sets openai `default_voice` to `"marin"`, and that default applies to `tts-1` and `tts-1-hd`. Those models reject `marin`, so `speech generate --model tts-1 --text hi` fails validation with no `--voice`. Case: `tests/speech/speech-request.test.ts` (search "gives tts-1 a default voice"). Fix: give tts-1 and tts-1-hd their own default, such as `alloy`.
2. **ElevenLabs voice check accepts inherited object keys.** `src/speech/speech-request.ts` around line 187 uses `voice in ELEVENLABS_RECOMMENDED_VOICES`. The `in` operator matches `Object.prototype` names such as `constructor`, so such a name skips the recommended-name check and reaches the request path. Case: `tests/speech/speech-command.test.ts`, "rejects an ElevenLabs --voice named constructor before any request". Fix: use `Object.hasOwn` or a `Map`.
3. **`--output` extension is not checked against the route format.** `--output clip.m4a` is accepted for an mp3 route. Case: `tests/speech/speech-command.test.ts`, "rejects an --output extension the route cannot write". Fix: check the extension in `formatFromOutput` (around line 376 of `speech-request.ts`).

Each `it.fails` case flips to a failure when its defect is fixed, which signals removing the marker.

## Decisions made in the tests

- A missing `--text-file` exits 5 with `NOT_FOUND`, not 2 with `INVALID_INPUT`. The generic classifier in `src/core/error-classify.ts` matches "file not found". The smoke test asserts the observed behaviour and carries a comment.
- The Gemini custom voice fixture now uses `voice_abc123`, the id form `isCustomGeminiVoiceId` accepts. The earlier `my-custom-voice-1` id was not valid.
- tts-1 fixtures pass `--voice alloy` explicitly, so they do not depend on defect 1.
- `biome check --write` reformatted my own test files only.

## Unresolved questions

- Should a missing `--text-file` be `INVALID_INPUT` (exit 2) to match the other speech validation? The current test pins exit 5.
- Should `.m4a` be rejected for mp3 routes, or should the route accept it? Defect 3 assumes rejection.
- `worker/src/jobs/run-argv-builder.ts` has an import reorder made by another session. It is not from this task and was left in place.
