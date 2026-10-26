/**
 * Versioned price list (`multix.pricing/v1`, runtime-neutral). Each entry maps
 * a provider's models to USD per unit for one billing tier, with dated price
 * windows (scheduled changes and promotions end on a known instant), the date
 * the price was last checked against the provider's own pricing page, and that
 * page's URL. A model without a verified, current, fresh entry resolves to
 * "unknown": callers must not invent a price or fall back to $0.
 *
 * Audio is not billed by one formula: Gemini TTS bills text tokens in and audio
 * tokens out (25 tokens per second), ElevenLabs bills characters, Fish Audio
 * bills UTF-8 bytes, speech-to-text bills seconds of input audio. The meter
 * names keep those units apart.
 *
 * OpenRouter resells many speech models under its own ids ("openrouter"
 * entries, priced from its models API): TTS `pricing.prompt` is USD per input
 * character (Gemini models: per token, with audio tokens under `completion`),
 * duration-billed STT `pricing.prompt` is USD per second of audio. Models
 * billed per generated second or per STT token are left out (unknown).
 */

export const PRICING_SCHEMA = "multix.pricing/v1";

/** What a price is charged on. */
export type PriceMeter =
  /** Text tokens sent to the model. */
  | "input_text_tokens"
  /** Audio tokens the model returns (Gemini: 25 per second of audio). */
  | "output_audio_tokens"
  /** Characters of the text to speak (Unicode code points as sent). */
  | "characters"
  /** UTF-8 bytes of the text to speak. */
  | "utf8_bytes"
  /** Seconds of audio sent for transcription. */
  | "input_audio_seconds";

export interface PriceComponent {
  meter: PriceMeter;
  /** USD for `per` units. */
  usd: number;
  per: number;
}

export interface PriceWindow {
  /** ISO instant the price starts (inclusive); open-ended when absent. */
  from?: string;
  /** ISO instant the price ends (exclusive); open-ended when absent. */
  until?: string;
  /** "promotion", "scheduled", ...; shown with the estimate. */
  label?: string;
  components: PriceComponent[];
}

export interface PriceEntry {
  /** Stable id: "<provider>/<model family>@<tier>". */
  id: string;
  /** CLI group the price applies to (gemini, elevenlabs) or the provider name. */
  provider: string;
  models: string[];
  /** Billing tier the price is for; free tiers and plan credits are not modelled. */
  tier: string;
  currency: "USD";
  region: string;
  windows: PriceWindow[];
  /** Date (YYYY-MM-DD) the price was read from `source`. */
  last_checked: string;
  source: string;
  /** False keeps the entry for reference but never prices a run. */
  verified: boolean;
  notes?: string;
}

/** A price older than this is not trusted: re-check the source and bump last_checked. */
export const MAX_PRICE_AGE_DAYS = 120;

/** Prices near a window boundary may follow either window (time zones, rollout). */
const BOUNDARY_MS = 24 * 3600 * 1000;

const GEMINI_PRICING = "https://ai.google.dev/gemini-api/docs/pricing";
const ELEVENLABS_PRICING = "https://elevenlabs.io/pricing/api";
const FISH_PRICING =
  "https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits";

const OPENROUTER_TTS_PRICING = "https://openrouter.ai/api/v1/models?output_modalities=speech";
const OPENROUTER_STT_PRICING =
  "https://openrouter.ai/api/v1/models?output_modalities=transcription";

const perM = (meter: PriceMeter, usd: number): PriceComponent => ({ meter, usd, per: 1_000_000 });
const perK = (meter: PriceMeter, usd: number): PriceComponent => ({ meter, usd, per: 1_000 });

function geminiTts(input: number, output: number): PriceComponent[] {
  return [perM("input_text_tokens", input), perM("output_audio_tokens", output)];
}

/** Gemini's scheduled 2027 price change, mirrored for the same models on OpenRouter. */
function geminiTtsWindows(input: number, output: number): PriceWindow[] {
  return [
    { until: "2027-01-01T00:00:00Z", label: "scheduled", components: geminiTts(input, output) },
    { from: "2027-01-01T00:00:00Z", components: geminiTts(input * 2, output * 2) },
  ];
}

const OPENROUTER_CHECKED = "2026-10-26";
const OPENROUTER_NOTES =
  "OpenRouter list price; BYOK requests are billed by the upstream provider plus OpenRouter's fee.";

/** OpenRouter TTS models priced per input character: [id, USD per 1M characters]. */
const OPENROUTER_TTS_PER_CHARACTER: [string, number][] = [
  ["elevenlabs/eleven-v4", 80],
  ["elevenlabs/eleven-v3", 80],
  ["elevenlabs/eleven-multilingual-v2", 80],
  ["elevenlabs/eleven-v4-turbo", 40],
  ["elevenlabs/eleven-v3-conversational", 40],
  ["elevenlabs/eleven-flash-v2.5", 40],
  ["elevenlabs/eleven-flash-v2", 40],
  ["elevenlabs/eleven-turbo-v2.5", 40],
  ["elevenlabs/eleven-turbo-v2", 40],
  ["fish-audio/drama-3", 2],
  ["fish-audio/s1", 15],
  ["fish-audio/s2-pro", 15],
  ["fish-audio/s2.1-pro", 15],
  ["mistralai/voxtral-mini-tts-3-0", 13],
  ["mistralai/voxtral-mini-tts-2603", 16],
  ["heygen/heygen-voice-1", 15],
  ["heygen/heygen-voice-1-turbo", 4],
  ["microsoft/mai-voice-2.1", 22],
  ["microsoft/mai-voice-2.1-flash", 15],
  ["microsoft/mai-voice-2", 22],
  ["microsoft/mai-voice-2-flash", 15],
  ["deepgram/flux-tts", 45],
  ["deepgram/aura-2", 30],
  ["qwen/qwen-audio-3.0-tts-flash", 15],
  ["qwen/qwen-audio-3.0-tts-plus", 20],
  ["minimax/speech-2.8-hd", 100],
  ["minimax/speech-2.8-turbo", 60],
  ["x-ai/grok-voice-tts-1.0", 15],
  ["canopylabs/orpheus-3b-0.1-ft", 7],
  ["sesame/csm-1b", 7],
  ["hexgrad/kokoro-82m", 0.62],
];

/** OpenRouter STT models priced per second of audio: [id, USD per second, as listed]. */
const OPENROUTER_STT_PER_SECOND: [string, number][] = [
  ["openai/whisper-large-v3-turbo", 0.00000333],
  ["openai/whisper-large-v3", 0.0000075],
  ["openai/whisper-1", 0.0001],
  ["openai/gpt-transcribe", 0.000075],
  ["elevenlabs/scribe-v2", 0.0000611111111111],
  ["elevenlabs/scribe-v2-medical", 0.0000611111111111],
  ["mistralai/voxtral-small-transcribe-3-0", 0.0000666667],
  ["mistralai/voxtral-mini-transcribe-3-0", 0.0000583333],
  ["mistralai/voxtral-mini-transcribe", 0.00005],
  ["mistralai/voxtral-small-24b-2507-stt", 0.00005],
  ["mistralai/voxtral-mini-3b-2507", 0.0000166667],
  ["assemblyai/universal-3-6-pro", 0.0000833333],
  ["assemblyai/universal-3-5-pro", 0.0000833333],
  ["fish-audio/transcribe-1", 0.0001],
  ["fish-audio/transcribe-1-pro", 0.0001],
  ["meta/muse-voice-transcribe-1.0", 0.00005],
  ["nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b", 0.00000333],
  ["nvidia/parakeet-tdt-0.6b-v3", 0.000025],
  ["qwen/qwen3-asr-1.7b", 0.0000075],
  ["qwen/qwen3-asr-0.6b", 0.00000333],
  ["x-ai/grok-stt-1.0", 0.0000277777777778],
  ["deepgram/nova-3", 0.0000716666666667],
  ["google/chirp-3", 0.000266666666667],
];

function openrouterEntry(
  id: string,
  models: string[],
  windows: PriceWindow[],
  source: string,
): PriceEntry {
  return {
    id: `openrouter/${id}@api`,
    provider: "openrouter",
    models,
    tier: "api-usage",
    currency: "USD",
    region: "global",
    windows,
    last_checked: OPENROUTER_CHECKED,
    source,
    verified: true,
    notes: OPENROUTER_NOTES,
  };
}

const OPENROUTER_ENTRIES: PriceEntry[] = [
  openrouterEntry(
    "google/gemini-3.8-flash-tts",
    ["google/gemini-3.8-flash-tts"],
    geminiTtsWindows(0.5, 9),
    OPENROUTER_TTS_PRICING,
  ),
  openrouterEntry(
    "google/gemini-3.8-flash-lite-tts",
    ["google/gemini-3.8-flash-lite-tts"],
    geminiTtsWindows(0.5, 6),
    OPENROUTER_TTS_PRICING,
  ),
  openrouterEntry(
    "google/gemini-3.1-flash-tts-preview",
    ["google/gemini-3.1-flash-tts-preview"],
    [{ components: geminiTts(1, 20) }],
    OPENROUTER_TTS_PRICING,
  ),
  ...OPENROUTER_TTS_PER_CHARACTER.map(([model, usd]) =>
    openrouterEntry(
      model,
      [model],
      [{ components: [perM("characters", usd)] }],
      OPENROUTER_TTS_PRICING,
    ),
  ),
  ...OPENROUTER_STT_PER_SECOND.map(([model, usd]) =>
    openrouterEntry(
      model,
      [model],
      [{ components: [{ meter: "input_audio_seconds", usd, per: 1 }] }],
      OPENROUTER_STT_PRICING,
    ),
  ),
];

export const PRICING_CATALOG: PriceEntry[] = [
  {
    id: "gemini/gemini-3.8-flash-tts@paid-standard",
    provider: "gemini",
    models: ["gemini-3.8-flash-tts"],
    tier: "paid-standard",
    currency: "USD",
    region: "global",
    windows: [
      { until: "2027-01-01T00:00:00Z", label: "scheduled", components: geminiTts(0.5, 9) },
      { from: "2027-01-01T00:00:00Z", components: geminiTts(1, 18) },
    ],
    last_checked: "2026-10-26",
    source: GEMINI_PRICING,
    verified: true,
    notes: "Free tier is free of charge; this is the paid Standard tier (upper bound).",
  },
  {
    id: "gemini/gemini-3.8-flash-lite-tts@paid-standard",
    provider: "gemini",
    models: ["gemini-3.8-flash-lite-tts"],
    tier: "paid-standard",
    currency: "USD",
    region: "global",
    windows: [
      { until: "2027-01-01T00:00:00Z", label: "scheduled", components: geminiTts(0.5, 6) },
      { from: "2027-01-01T00:00:00Z", components: geminiTts(1, 12) },
    ],
    last_checked: "2026-10-26",
    source: GEMINI_PRICING,
    verified: true,
    notes: "Free tier is free of charge; this is the paid Standard tier (upper bound).",
  },
  {
    id: "gemini/gemini-3.1-flash-tts-preview@paid-standard",
    provider: "gemini",
    models: ["gemini-3.1-flash-tts-preview"],
    tier: "paid-standard",
    currency: "USD",
    region: "global",
    windows: [{ components: geminiTts(1, 20) }],
    last_checked: "2026-10-26",
    source: GEMINI_PRICING,
    verified: true,
  },
  {
    id: "gemini/gemini-2.5-flash-preview-tts@paid-standard",
    provider: "gemini",
    models: ["gemini-2.5-flash-preview-tts"],
    tier: "paid-standard",
    currency: "USD",
    region: "global",
    windows: [{ components: geminiTts(0.5, 10) }],
    last_checked: "2026-10-26",
    source: GEMINI_PRICING,
    verified: true,
  },
  {
    id: "gemini/gemini-2.5-pro-preview-tts@paid-standard",
    provider: "gemini",
    models: ["gemini-2.5-pro-preview-tts"],
    tier: "paid-standard",
    currency: "USD",
    region: "global",
    windows: [{ components: geminiTts(1, 20) }],
    last_checked: "2026-10-26",
    source: GEMINI_PRICING,
    verified: true,
  },
  {
    id: "elevenlabs/multilingual@api",
    provider: "elevenlabs",
    models: ["eleven_v4", "eleven_v3", "eleven_multilingual_v2"],
    tier: "api-usage",
    currency: "USD",
    region: "global",
    windows: [{ components: [perK("characters", 0.08)] }],
    last_checked: "2026-10-26",
    source: ELEVENLABS_PRICING,
    verified: true,
    notes: "API usage billed in USD per character; subscription plans spend credits instead.",
  },
  {
    id: "elevenlabs/flash-turbo@api",
    provider: "elevenlabs",
    models: [
      "eleven_v4_turbo",
      "eleven_flash_v2_5",
      "eleven_flash_v2",
      "eleven_turbo_v2_5",
      "eleven_turbo_v2",
    ],
    tier: "api-usage",
    currency: "USD",
    region: "global",
    windows: [{ components: [perK("characters", 0.04)] }],
    last_checked: "2026-10-26",
    source: ELEVENLABS_PRICING,
    verified: true,
    notes: "API usage billed in USD per character; subscription plans spend credits instead.",
  },
  {
    id: "fish/s2-pro@api",
    provider: "fish",
    models: ["s2.1-pro", "s2-pro"],
    tier: "api-usage",
    currency: "USD",
    region: "global",
    windows: [{ components: [perM("utf8_bytes", 15)] }],
    last_checked: "2026-10-26",
    source: FISH_PRICING,
    verified: true,
  },
  {
    id: "fish/s1@api",
    provider: "fish",
    models: ["s1"],
    tier: "api-usage",
    currency: "USD",
    region: "global",
    // Retired after 2026; requests are then served (and billed) as s2.1-pro.
    windows: [{ components: [perM("utf8_bytes", 15)] }],
    last_checked: "2026-10-26",
    source: FISH_PRICING,
    verified: true,
  },
  {
    id: "fish/drama-3@api",
    provider: "fish",
    models: ["drama-3"],
    tier: "api-usage",
    currency: "USD",
    region: "global",
    windows: [
      {
        until: "2026-11-12T17:00:00Z",
        label: "promotion",
        components: [perM("utf8_bytes", 10)],
      },
      { from: "2026-11-12T17:00:00Z", components: [perM("utf8_bytes", 50)] },
    ],
    last_checked: "2026-10-26",
    source: FISH_PRICING,
    verified: true,
  },
  ...OPENROUTER_ENTRIES,
];

export interface ResolvedRate {
  id: string;
  provider: string;
  model: string;
  tier: string;
  currency: "USD";
  region: string;
  /** Price in force at the requested instant. */
  components: PriceComponent[];
  /** Highest price per meter among windows within a day of the instant. */
  upper_components: PriceComponent[];
  label?: string;
  effective_from?: string;
  effective_until?: string;
  last_checked: string;
  source: string;
  notes?: string;
}

export type RateLookup =
  | { ok: true; rate: ResolvedRate }
  | { ok: false; reason: "no_price" | "unverified" | "stale" | "no_window"; detail: string };

function inWindow(w: PriceWindow, t: number): boolean {
  return (
    (w.from === undefined || Date.parse(w.from) <= t) &&
    (w.until === undefined || t < Date.parse(w.until))
  );
}

function nearWindow(w: PriceWindow, t: number): boolean {
  return (
    (w.from === undefined || Date.parse(w.from) <= t + BOUNDARY_MS) &&
    (w.until === undefined || t - BOUNDARY_MS < Date.parse(w.until))
  );
}

function maxComponents(windows: PriceWindow[]): PriceComponent[] {
  const byMeter = new Map<PriceMeter, PriceComponent>();
  for (const w of windows) {
    for (const c of w.components) {
      const prev = byMeter.get(c.meter);
      if (!prev || c.usd / c.per > prev.usd / prev.per) byMeter.set(c.meter, c);
    }
  }
  return [...byMeter.values()];
}

/** The trusted price for one provider model at `at`, or why there is none. */
export function resolveRate(
  provider: string,
  model: string,
  at: Date = new Date(),
  catalog: PriceEntry[] = PRICING_CATALOG,
): RateLookup {
  const entry = catalog.find((e) => e.provider === provider && e.models.includes(model));
  if (!entry) {
    return { ok: false, reason: "no_price", detail: `No price on file for ${provider} ${model}` };
  }
  if (!entry.verified) {
    return { ok: false, reason: "unverified", detail: `Price ${entry.id} is not verified` };
  }
  const t = at.getTime();
  const ageDays = (t - Date.parse(`${entry.last_checked}T00:00:00Z`)) / 86_400_000;
  if (!(ageDays <= MAX_PRICE_AGE_DAYS)) {
    return {
      ok: false,
      reason: "stale",
      detail: `Price ${entry.id} was last checked ${entry.last_checked}, over ${MAX_PRICE_AGE_DAYS} days ago`,
    };
  }
  const current = entry.windows.find((w) => inWindow(w, t));
  if (!current) {
    return {
      ok: false,
      reason: "no_window",
      detail: `Price ${entry.id} has no window covering ${at.toISOString()}`,
    };
  }
  return {
    ok: true,
    rate: {
      id: entry.id,
      provider: entry.provider,
      model,
      tier: entry.tier,
      currency: entry.currency,
      region: entry.region,
      components: current.components,
      upper_components: maxComponents(entry.windows.filter((w) => nearWindow(w, t))),
      ...(current.label ? { label: current.label } : {}),
      ...(current.from ? { effective_from: current.from } : {}),
      ...(current.until ? { effective_until: current.until } : {}),
      last_checked: entry.last_checked,
      source: entry.source,
      ...(entry.notes ? { notes: entry.notes } : {}),
    },
  };
}

/** USD for `units` of `meter` under `components`; undefined when the meter has no price. */
export function priceOf(
  components: PriceComponent[],
  meter: PriceMeter,
  units: number,
): number | undefined {
  const c = components.find((x) => x.meter === meter);
  return c ? (units * c.usd) / c.per : undefined;
}
