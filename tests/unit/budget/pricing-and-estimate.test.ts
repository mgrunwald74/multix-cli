import { describe, expect, it } from "vitest";
import { checkBudget, estimateCommand, parseMaxCost } from "../../../src/budget/command-cost.js";
import { countText, estimateCost } from "../../../src/budget/cost-estimate.js";
import {
  MAX_PRICE_AGE_DAYS,
  PRICING_CATALOG,
  type PriceEntry,
  resolveRate,
} from "../../../src/budget/pricing-catalog.js";
import { BudgetError } from "../../../src/core/errors.js";

const AT = new Date("2026-10-26T12:00:00Z");
const VI_NFC = "Xin chào thế giới";
const VI_NFD = VI_NFC.normalize("NFD");

describe("pricing catalog", () => {
  it("every entry is verified, dated and sourced from the provider's own pricing page", () => {
    for (const e of PRICING_CATALOG) {
      expect(e.verified).toBe(true);
      expect(e.last_checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.source).toMatch(
        /^https:\/\/(ai\.google\.dev|elevenlabs\.io|docs\.fish\.audio|openrouter\.ai)\//,
      );
      expect(e.windows.length).toBeGreaterThan(0);
    }
  });

  it("unknown, unverified or stale prices resolve to unknown, never $0", () => {
    expect(resolveRate("gemini", "gemini-9-tts", AT)).toMatchObject({
      ok: false,
      reason: "no_price",
    });
    const unverified: PriceEntry = { ...(PRICING_CATALOG[0] as PriceEntry), verified: false };
    expect(resolveRate("gemini", "gemini-3.8-flash-tts", AT, [unverified])).toMatchObject({
      ok: false,
      reason: "unverified",
    });
    const later = new Date(Date.parse("2026-10-26") + (MAX_PRICE_AGE_DAYS + 1) * 86_400_000);
    expect(resolveRate("gemini", "gemini-3.8-flash-tts", later)).toMatchObject({
      ok: false,
      reason: "stale",
    });
  });

  it("an expired promotion switches to the list price (Fish drama-3)", () => {
    const promo = resolveRate("fish", "drama-3", new Date("2026-11-01T00:00:00Z"));
    const list = resolveRate("fish", "drama-3", new Date("2026-11-12T17:00:00Z"));
    expect(promo.ok && promo.rate.components[0]?.usd).toBe(10);
    expect(promo.ok && promo.rate.label).toBe("promotion");
    expect(list.ok && list.rate.components[0]?.usd).toBe(50);
    expect(list.ok && list.rate.label).toBeUndefined();
  });

  it("near a price change the ceiling uses the higher price", () => {
    const eve = resolveRate("gemini", "gemini-3.8-flash-tts", new Date("2026-12-31T20:00:00Z"));
    expect(eve.ok && eve.rate.components.find((c) => c.meter === "output_audio_tokens")?.usd).toBe(
      9,
    );
    expect(
      eve.ok && eve.rate.upper_components.find((c) => c.meter === "output_audio_tokens")?.usd,
    ).toBe(18);
  });
});

describe("unit counting", () => {
  it("counts Vietnamese characters as code points and bytes as UTF-8", () => {
    expect(countText(VI_NFC)).toEqual({ characters: 17, nfc_characters: 17, utf8_bytes: 22 });
    // Decomposed input has more code points (billed characters) but the same NFC length.
    const nfd = countText(VI_NFD);
    expect(nfd.characters).toBeGreaterThan(17);
    expect(nfd.nfc_characters).toBe(17);
    expect(nfd.utf8_bytes).toBeGreaterThan(22);
  });

  it("counts emoji and CJK as one character each", () => {
    expect(countText("ok 👍")).toMatchObject({ characters: 4, utf8_bytes: 7 });
    expect(countText("你好")).toMatchObject({ characters: 2, utf8_bytes: 6 });
  });
});

describe("estimates", () => {
  it("ElevenLabs bills characters: proven ceiling, context text only in the high end", () => {
    const e = estimateCost({
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      text: VI_NFC,
      extra_text: ["Trước đó."],
      at: AT,
    });
    expect(e).toMatchObject({ status: "estimated", upper_bound: "proven" });
    expect(e.units.characters).toEqual({ low: 17, expected: 17, high: 26 });
    expect(e.expected_usd).toBeCloseTo(17 * 0.00008, 9);
    expect(e.high_usd).toBeCloseTo(26 * 0.00008, 9);
  });

  it("Fish bills UTF-8 bytes, not characters", () => {
    const e = estimateCost({ provider: "fish", model: "s2-pro", text: VI_NFC, at: AT });
    expect(e.units.utf8_bytes).toEqual({ low: 22, expected: 22, high: 22 });
    expect(e.units.characters).toBeUndefined();
    expect(e.high_usd).toBeCloseTo((22 * 15) / 1e6, 9);
    expect(e.upper_bound).toBe("proven");
  });

  it("Gemini TTS bills text tokens in and audio tokens out: ceiling is only estimated", () => {
    const e = estimateCost({
      provider: "gemini",
      model: "gemini-3.8-flash-tts",
      text: "a".repeat(140),
      at: AT,
    });
    expect(e.upper_bound).toBe("estimated");
    expect(e.units.output_audio_seconds?.expected).toBe(10);
    expect(e.units.output_audio_tokens?.expected).toBe(250);
    expect(e.rate?.effective_until).toBe("2027-01-01T00:00:00Z");
    expect(e.low_usd ?? 0).toBeLessThan(e.expected_usd ?? 0);
    expect(e.expected_usd ?? 0).toBeLessThan(e.high_usd ?? 0);
  });

  it("commands without an estimator are unknown, not free", () => {
    const e = estimateCommand("openai generate", { prompt: "x" }, { at: AT });
    expect(e).toMatchObject({ status: "unknown", reason: "unsupported", high_usd: null });
    expect(estimateCommand("elevenlabs tts", {}, { at: AT })).toMatchObject({
      status: "unknown",
      reason: "missing_input",
    });
  });

  it("reads kebab-case (MCP) and camelCase (commander) options alike", () => {
    const mcp = estimateCommand(
      "elevenlabs tts",
      { text: "hi", "previous-text": "abc" },
      { at: AT },
    );
    const cli = estimateCommand("elevenlabs tts", { text: "hi", previousText: "abc" }, { at: AT });
    expect(mcp.units.characters?.high).toBe(5);
    expect(cli.units).toEqual(mcp.units);
    const flags = estimateCommand(
      "elevenlabs tts",
      { "--text": "hi", "--previous-text": "abc" },
      { at: AT },
    );
    expect(flags.units).toEqual(mcp.units);
  });
});

describe("OpenRouter speech estimates", () => {
  it("prices TTS per input character with a proven ceiling; instructions only in the high end", () => {
    const e = estimateCommand(
      "openrouter tts",
      { text: VI_NFC, instructions: "calm", model: "ElevenLabs/Eleven-V4" },
      { at: AT },
    );
    expect(e).toMatchObject({
      status: "estimated",
      upper_bound: "proven",
      provider: "openrouter",
      model: "elevenlabs/eleven-v4",
      rate: { id: "openrouter/elevenlabs/eleven-v4@api" },
    });
    expect(e.units.characters).toEqual({ low: 17, expected: 17, high: 21 });
    expect(e.high_usd).toBeCloseTo((21 * 80) / 1e6, 9);
  });

  it("prices the default Gemini TTS model in tokens: ceiling only estimated", () => {
    const e = estimateCommand("openrouter tts", { text: "hello" }, { at: AT });
    expect(e).toMatchObject({
      status: "estimated",
      upper_bound: "estimated",
      model: "google/gemini-3.8-flash-tts",
    });
    expect(e.units.output_audio_tokens).toBeDefined();
  });

  it("transcription with an exact duration is a proven per-second ceiling", () => {
    const e = estimateCommand(
      "openrouter transcribe",
      { input: "talk.wav", model: "openai/whisper-1" },
      { at: AT, audio: { seconds: 59.2, bytes: 1_894_444 } },
    );
    expect(e).toMatchObject({ status: "estimated", upper_bound: "proven" });
    expect(e.units.input_audio_seconds).toEqual({ low: 60, expected: 60, high: 60 });
    expect(e.high_usd).toBeCloseTo(60 * 0.0001, 9);
  });

  it("transcription sized only by bytes gives a range whose high end is an estimate", () => {
    const e = estimateCommand(
      "openrouter transcribe",
      { input: "talk.mp3" },
      { at: AT, audio: { bytes: 480_000 } },
    );
    expect(e).toMatchObject({
      status: "estimated",
      upper_bound: "estimated",
      model: "openai/whisper-large-v3-turbo",
    });
    // 480 kB = 3.84 Mbit: 12 s at 320 kbps, 60 s at 64 kbps, 640 s at 6 kbps.
    expect(e.units.input_audio_seconds).toEqual({ low: 12, expected: 60, high: 640 });
    expect(() => checkBudget(e, 1, "strict")).toThrow(/not a proven cap/);
    expect(() => checkBudget(e, 1, "estimate")).not.toThrow();
  });

  it("transcription without a measured local file, or of a token-priced model, is unknown", () => {
    expect(
      estimateCommand("openrouter transcribe", { input: "https://x/a.mp3" }, { at: AT }),
    ).toMatchObject({ status: "unknown", reason: "missing_input" });
    expect(
      estimateCommand(
        "openrouter transcribe",
        { input: "a.wav", model: "openai/gpt-4o-transcribe" },
        { at: AT, audio: { seconds: 3 } },
      ),
    ).toMatchObject({ status: "unknown", reason: "no_price" });
  });

  it("an OpenRouter TTS model billed per generated second is not priced", () => {
    expect(
      estimateCommand(
        "openrouter tts",
        { text: "hi", model: "bytedance-seed/seed-audio-1-0" },
        { at: AT },
      ),
    ).toMatchObject({ status: "unknown", reason: "no_price" });
  });
});

describe("spend guard", () => {
  const eleven = estimateCommand("elevenlabs tts", { text: "hello" }, { at: AT });
  const gemini = estimateCommand("gemini generate-speech", { text: "hello" }, { at: AT });
  const none = estimateCommand("openai generate", { prompt: "x" }, { at: AT });

  it("passes a proven ceiling under the limit and refuses one over it", () => {
    expect(() => checkBudget(eleven, 1, "strict")).not.toThrow();
    expect(() => checkBudget(eleven, 0.0001, "strict")).toThrow(/exceeds --max-cost/);
  });

  it("refuses an estimated ceiling unless the policy accepts it", () => {
    expect(() => checkBudget(gemini, 1, "strict")).toThrow(BudgetError);
    expect(() => checkBudget(gemini, 1, "estimate")).not.toThrow();
  });

  it("refuses an unknown price whatever the policy", () => {
    for (const policy of ["strict", "estimate"] as const) {
      try {
        checkBudget(none, 100, policy);
        expect.unreachable();
      } catch (error) {
        expect((error as BudgetError).code).toBe("BUDGET_UNPROVEN");
      }
    }
  });

  it("rejects malformed limits", () => {
    expect(parseMaxCost("0.25")).toBe(0.25);
    expect(parseMaxCost(0)).toBe(0);
    for (const bad of ["", "abc", "-1", "Infinity", "0x10", "1e3"]) {
      expect(() => parseMaxCost(bad)).toThrow();
    }
  });
});
