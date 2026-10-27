# docs-manager: `multix speech` docs (issue #296)

Scope: this report covers only the speech-facade docs pass. It is a record of one change, not product authority.

## Files changed

- `docs-site/src/content/docs/commands/speech.md` (new): models discovery, generate flags, Vietnamese Gemini dialogue and MiniMax emotion examples, routing rules, agent mode, remote MCP.
- `docs-site/src/content/docs/vi/commands/speech.md` (new): Vietnamese mirror.
- `docs-site/astro.config.mjs`: sidebar entry `commands/speech` (with a vi label).
- `docs-site/src/pages/llms.txt.ts`: speech route (the docs-site test requires every English page to be listed).
- `docs-site/src/content/docs/{,vi/}commands.md`: overview row.
- `docs-site/src/content/docs/{,vi/}reference/for-ai-agents.md`: capability-map row.
- `docs-site/src/content/docs/{,vi/}guides/mcp-server.md`: speech paragraph, plus the key-scope sentence in the security model now covers routed providers.
- `README.md`: `multix speech` section before `multix media`.
- `skill/SKILL.md`: when-to-use bullet and a "Speech across providers" discovery block.

## Evidence

- Flags: `node dist/cli.js speech {generate,models} --help`, after `npm run build`.
- Behavior: `src/commands/speech/index.ts`, `src/speech/speech-request.ts`, `src/speech/speech-catalog.ts`, `worker/src/jobs/cli-command-policy.ts`.
- Every documented `speech generate` example passed `--dry-run --json` with `ok: true`. These runs used `MULTIX_DISABLE_HOME_ENV=1` and `HTTPS_PROXY=http://127.0.0.1:9`, so nothing was sent.
- The fallback example was run with `ELEVENLABS_API_KEY` unset. It produced `data.fallback` with the voice and billing differences.

## Verification

- `npm run verify:docs`: astro check reported 0 errors and 0 warnings, the build succeeded, and the tests passed 8 of 8. The first run failed with "llms.txt is missing commands/speech.md"; adding the route fixed it.
- All internal links on the new pages resolve to built routes.
- `npm run lint` reports one error, in `worker/src/jobs/run-argv-builder.ts` (organizeImports). That file was not touched in this pass.
