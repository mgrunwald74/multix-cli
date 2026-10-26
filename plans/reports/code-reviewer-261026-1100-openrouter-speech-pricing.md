# Code review: f739e0d feat(budget): price openrouter tts and transcribe (#339)

## Scope
- Files: src/budget/{audio-duration,command-cost,cost-estimate,pricing-catalog}.ts, src/agent/cost-preflight.ts, src/providers/openrouter/speech-client.ts, tests/unit/budget/*, tests/smoke/budget-guard.test.ts, README/docs/skill
- LOC: +548 / -20
- Checks run: `npx vitest run tests/unit/budget tests/smoke/budget-guard.test.ts` 54/54 pass; `npm run typecheck` clean; biome clean on touched files; `npm run check:mcp` passes (worker typecheck, tests, bundle clean of node:*).
- Prices cross-checked programmatically against or-speech.json / or-transcription.json: all 57 OpenRouter entries match `pricing.prompt` (and `completion` for the 3 Gemini entries); every per-char/per-second entry has completion 0. Excluded: seed-audio (per generated second), s2.1-pro-free:free, gemini-3.5-transcribe, gpt-4o(-mini)-transcribe (token), mai-transcribe-1.5/2 (prompt 0.36 / 0.1, a different unit).

## Overall
Wiring is sound: commander camelCase and MCP kebab/`--` keys reach the builders identically; `--text-file`/`--turns-file`, URL inputs and MCP transcribe all fail closed; text/prompt conflicts are rejected by the command before any request; model lowercasing is safe (unknown ids, `:variant` suffixes and canonical slugs resolve to `unknown`). But the "proven" ceiling can be beaten in three ways, one confirmed end to end.

## Critical

### C1. WAV duration trusts the header's avgBytesPerSec: strict `--max-cost` admits a run billed 600x the cap
src/budget/audio-duration.ts:25-30. Duration = payload / `byteRate` (fmt offset +8). Decoders ignore that field for PCM and use sampleRate x blockAlign. Proven by experiment: a 600 s 16 kHz mono PCM WAV (19.2 MB, under the 25 MB upload cap) with byteRate set to 0xFFFFFFFF:
- `wavDurationSeconds` -> 0.0045 s -> billed 1 s, `upper_bound: "proven"`
- `node dist/cli.js openrouter transcribe --input lie.wav --model google/chirp-3 --estimate --max-cost 0.01 --json` -> `budget.ok: true`, high_usd $0.000267
- ffprobe and Python `wave` both report 600.000 s, a real bill of $0.16 (600x the estimate, 16x the cap).
The file needs no tampering by the user: a buggy writer or untrusted downloaded audio (an agent fetches a file, then transcribes it locally) is enough. Non-PCM WAV (format tags such as 0x55 MP3, 0x11 ADPCM, GSM) has only a nominal byteRate, so the same gap applies with ordinary files. A later second `fmt ` chunk also overrides the first (most decoders use the first).
Fix: parse the whole fmt chunk; return undefined (bytes path, so estimated) unless the format tag is PCM (1), IEEE float (3) or EXTENSIBLE (0xFFFE) with a PCM/float subformat, channels >= 1, blockAlign == channels*bits/8, and byteRate == sampleRate*blockAlign. Compute seconds as payload / (sampleRate*blockAlign). Reject a second fmt chunk. Add unit tests for the inflated byteRate, a non-PCM tag, and a second fmt chunk.

## High

### H1. TTS "characters" are counted as code points, while the billing unit is unverified (UTF-16 units or Fish's UTF-8 bytes)
src/budget/cost-estimate.ts:94,149; catalog src/budget/pricing-catalog.ts:117-120. The proven ceiling uses `[...text].length`. Two signs this can undercount:
- The CLI's own post-run estimate uses UTF-16 `.length` (src/providers/openrouter/commands/tts.ts:164-165, used at :402). For `"😀".repeat(1000)` on minimax/speech-2.8-hd the preflight proves a $0.10 cap, but the command counts 2000 chars ($0.20). If OpenRouter, written in TypeScript, counts `.length`, the bill is twice the "proven" cap for emoji, CJK Ext-B or math alphanumerics.
- Fish Audio bills UTF-8 bytes directly (the repo's own `fish/*` entries use `utf8_bytes` at $15/M). OpenRouter lists fish-audio/s1, s2-pro and s2.1-pro at the same $15/M, which suggests a pass-through of the byte unit. Vietnamese test text "Xin chào thế giới, đây là tiếng Việt" is 36 code points but 48 bytes (1.33x); CJK is 3x.
Fix: for a proven high end, count the most conservative plausible unit, max(code points, UTF-16 units). For `fish-audio/*` also use utf8_bytes, or mark the bound "estimated" whenever the text is non-ASCII. Otherwise, record in the catalog the evidence for OpenRouter's counting rule.

### H2. OpenRouter fish-audio/drama-3 has no end date though the upstream promotion ends 2026-11-12
src/budget/pricing-catalog.ts:117 vs :353-366. The direct entry knows drama-3 rises from $10/M to $50/M bytes on 2026-11-12T17:00Z. The OpenRouter entry is $2/M in a single open-ended window, valid until it goes stale (~2027-02-23). OpenRouter's $2 is already 5x below the upstream promotional price, so it is most likely a launch promotion. If OpenRouter follows the upstream change, every strict run between 2026-11-12 and Feb 2027 is under-proven by up to 25x (more with H1's byte factor). The commit mirrors Gemini's 2027 change for OpenRouter (geminiTtsWindows, :95) but not this one, which is inconsistent.
Fix: end the drama-3 window at 2026-11-12T17:00:00Z with no successor (resolves to `no_window`, so it fails closed until re-checked), or add a successor window at the upstream $50/M as the upper bound.

## Medium

### M1. `--provider-options` can add billed text the estimator never sees
src/budget/command-cost.ts:84-94. Per-character models are reported proven while a free-form `--provider-options` JSON object goes into the request body (tts.ts, `body.provider.options`). For example `{"elevenlabs":{"previous_text":"<10k chars>"}}`: the repo's own `elevenlabs tts` builder treats previous/next text as possibly billed, but here it is invisible (probe: still proven, $0.00016). Fix: when provider-options is present, downgrade `upper_bound` to "estimated" (or count its string values in the high end).

### M2. The budget module imports two full HTTP clients to read two string constants
src/budget/command-cost.ts:12-13. This pulls speech-client.ts and transcription-client.ts, with their fetch, redirect and streaming code, into the Worker bundle. It also forced the unrelated `clearTimeout` guard in speech-client.ts:205-206. The other providers keep defaults in a leaf module (`elevenlabs/models.js`, `gemini/voices.js`). Fix: move `DEFAULT_OPENROUTER_TTS_MODEL` and `DEFAULT_OPENROUTER_STT_MODEL` into a constants-only `src/providers/openrouter/speech-models.ts` and drop the speech-client edit.

### M3. The STT price unit is inferred per model, and nothing records or tests it
pricing-catalog.ts:139-163. The snapshot itself shows that `pricing.prompt` does not share one unit across STT models: mai-transcribe-1.5 is 0.36 and mai-transcribe-2 is 0.1, clearly not per second, and they were silently left out. The proven claim for the 23 included models depends on each being per second. A model OpenRouter later reprices per token would keep a "proven" per-second price for up to 120 days. Fix: note the exclusion rule and the mai models in the catalog comment, and add a unit test that pins the snapshot-derived list (or a magnitude sanity bound such as 1e-6 to 1e-3 USD/s).

## Low
- L1 cost-estimate.ts:186 vs :241. The proven condition checks `audio.seconds !== undefined` while the exact branch also needs `seconds >= 0`. A NaN or negative value would take the byte-guess range yet be labelled proven. This cannot happen from today's callers; mirror the same predicate.
- L2 cost-estimate.ts:187. `Math.max(1, ceil(s))` assumes per-second billing with a 1 s minimum. Per-request minimums (e.g. 15 s increments) or per-channel billing of stereo audio would exceed it. This is unverified; see the unresolved questions.
- L3 cost-preflight.ts:41-56. A data chunk after 64 KB of leading chunks (embedded art or a large LIST) falls back to the estimated byte path. That is safe, but undocumented in the docs table.
- L4 cost-estimate.ts:84-90 (AUDIO_BITRATE). The 6 kbps "floor" is not a floor for accepted formats such as AMR-NB at 4.75 kbps. This affects only `--cost-policy estimate`.
- L5. TOCTOU: the file is measured in preflight and read again by the action. If it is replaced between the two reads (for example by a recorder still writing it), the run is billed for content that was never priced. The window is small.

## Edge cases scouted, verified safe
- camelCase (commander `textFile`, `costPolicy`) vs MCP `text`/`--text` keys: the builder sees the same value the argv builder emits; duplicate keys are last-wins on both sides.
- `--text` + `--text-file`, or `--text` + `--prompt`, is rejected by `inputText` before the key, catalog GET or POST.
- The env default model (OPENROUTER_TTS_MODEL / STT) is applied as a commander default, so preflight and the action read the same `run.options.model`.
- Case-variant `--model` with `--no-model-check` prices the lowercased id. OpenRouter either resolves it to the same model or rejects it (no charge).
- MCP transcribe always resolves to `unknown` (no audio defaults), and MCP inputs (`text-file` URLs) fail closed.
- Runtime neutrality: src/budget has no `node:*` imports; the bundle check passes.

## Test gaps
1. A WAV whose byteRate disagrees with sampleRate x blockAlign, a non-PCM fmt tag, and a duplicate fmt chunk (C1).
2. Astral, NFD and non-ASCII text for per-character and Fish models, asserting the conservative unit (H1).
3. Price-window boundary for OpenRouter drama-3 at 2026-11-12 (H2).
4. `--provider-options` downgrades the bound (M1).
5. A snapshot-pinned price table test (M3). Today only the source domain is asserted.
6. The MCP `costPreflight("openrouter transcribe", …)` path and `openrouter tts` with `--text-file` in the smoke tests. Both are fail-closed by construction, but not exercised.

## Recommended actions
1. Fix C1 before merge (blocking): validate the PCM fmt and derive the rate from sampleRate x blockAlign.
2. Fix H2 (bound the drama-3 window) and H1 (conservative character unit, or "estimated" for non-ASCII and Fish).
3. Fix M1 and M2; document M3.

## Unresolved questions
- How does OpenRouter count TTS "characters" (UTF-16, code points, or the upstream unit such as Fish's UTF-8 bytes)?
- Do OpenRouter STT routes have minimum billable durations or per-channel billing (Deepgram/Google multichannel)?
- Is OpenRouter's drama-3 $2/M a promotion, and what is its end date?
