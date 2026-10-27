# Code review: `multix speech` façade (#296)

Isolated review (separate reviewer agent) of `git diff 5151636..4f5ef57`.
No critical or high findings. Gates verified green by the reviewer: lint,
typecheck, build, test (1632), check:mcp (387 + bundle), verify:docs, catalog
sync. Remote key scoping holds: only `--provider`/`--fallback` values that
exactly name one of the five speech providers become key groups.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| M1 | medium | A fallback on another provider reused the primary `--voice`; MiniMax accepted ElevenLabs-shaped ids | Fallbacks on another provider get their own default unless the route names a voice; MiniMax rejects any other provider's voice shape |
| M2 | medium | ElevenLabs voice placed unencoded in the URL path (`../../v1/user`) | Voice must be `[A-Za-z0-9_-]`; adapter encodes it. Same pattern in `elevenlabs tts`: #330, fixed here |
| M3 | medium | MiniMax cut text at 10,000 chars on a paid request | `max_chars` per model (OpenAI 4096, MiniMax 10,000, ElevenLabs per model), rejected before any request |
| M4 | medium | Dated snapshots / env overrides (`gpt-4o-mini-tts-2025-12-15`) rejected | Ids `<known model>-…` take the family's capabilities |
| L1 | low | `--fallback <provider[:model[:voice]]>` made Commander mark the value optional | Placeholder `<route>`; catalog regenerated (`valueOptional: false`) |
| L2 | low | Atlas dry run stops at the schema lookup | Documented (EN/VI) |
| L3 | low | "text never echoed" too broad | Docs narrowed to `data.request` |
| L4 | low | Atlas `--async` printed the job id twice | Façade no longer reprints; runner prints id (stdout) and resume (stderr) |
| L5 | low | `--voice` silently ignored with `--speaker` | Rejected |
| L6 | low | "ISO 639-1" vs `fil`/`yue` codes | Help and docs say "language code" |

Tests added for each fix in `tests/speech/speech-request.test.ts` and
`tests/speech/speech-command.test.ts`; full suite 1641 passed after fixes.
