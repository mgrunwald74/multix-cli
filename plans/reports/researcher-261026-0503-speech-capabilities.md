# Speech capability research for #296 (2026-10-26)

Sources are the `source` URLs in `src/speech/speech-catalog.ts`.

| Provider / model | Languages | Language param | Notes |
|---|---|---|---|
| Gemini 3.8 Flash-Lite TTS | 78 codes listed on the speech-generation page | none (detected from text) | style prompts, 2 speakers |
| Gemini 3.8 Flash TTS | Flash-Lite list + 21 more | none | as above |
| Gemini 2.5 / 3.1 preview TTS | no per-model list | none | shut down 2026-11-17 |
| OpenAI gpt-4o-mini-tts, tts-1, tts-1-hd | Whisper's 57 languages | none | `instructions` only on gpt-4o-mini-tts; tts-1* take 9 voices |
| ElevenLabs eleven_v3 | 70+ codes | `language_code` | |
| ElevenLabs *_v2_5 | v2 list + hu, no, vi | `language_code` | |
| ElevenLabs multilingual_v2 | 29 codes | none (rejects `language_code`) | |
| ElevenLabs flash_v2 / turbo_v2 | en | none | |
| MiniMax speech-2.6/2.8 | `language_boost` names (40) | `language_boost` | emotions happy, sad, angry, fearful, disgusted, surprised, calm; 2.6 adds fluent, whisper |
| MiniMax speech-02 | as above minus fa, fil, ta | `language_boost` | |
| Atlas xai/tts-v1 | en zh ar bn fr de hi id it ja ko pt ru es tr vi | `language` | mp3/wav/pcm, async |

Unverified: ElevenLabs voice ids have no documented fixed format, so the
façade only rejects names that belong to another provider.
