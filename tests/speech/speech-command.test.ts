/**
 * `multix speech generate` run in-process with fetch mocked: key-based fallback,
 * the paid no-retry rule, validation before any request, async submission and
 * the provenance recorded for the result envelope.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectOutput } from "../../src/agent/output-file-inspect.js";
import { ConfigError, HttpError, ValidationError } from "../../src/core/errors.js";
import { _resetOutputDir } from "../../src/core/output-dir.js";
import {
  type FetchHandler,
  type RecordedCall,
  audioReply,
  jsonReply,
  recordFetch,
  runSpeech,
  setSpeechEnv,
} from "./speech-test-helpers.js";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const ATLAS_SUBMIT = "https://api.atlascloud.ai/api/v1/model/generateAudio";

let tmp: string;
let restoreEnv: (() => void) | undefined;
let restoreFetch: (() => void) | undefined;
let calls: RecordedCall[];

function useEnv(vars: Record<string, string | undefined> = {}): void {
  restoreEnv?.();
  restoreEnv = setSpeechEnv({ MULTIX_OUTPUT_DIR: tmp, ...vars });
  _resetOutputDir();
}

function useFetch(handler: FetchHandler): void {
  restoreFetch?.();
  const mock = recordFetch(handler);
  calls = mock.calls;
  restoreFetch = mock.restore;
}

const posts = (prefix = "") => calls.filter((c) => c.method === "POST" && c.url.startsWith(prefix));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "multix-speech-command-"));
  useEnv();
  // Any request the test did not expect fails loudly.
  useFetch(() => {
    throw new Error("unexpected network call");
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  restoreFetch?.();
  restoreEnv?.();
  restoreFetch = undefined;
  restoreEnv = undefined;
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("missing key", () => {
  it("a route with no key throws ConfigError and sends nothing", async () => {
    useEnv();
    await expect(runSpeech(["generate", "--provider", "openai", "--text", "hi"])).rejects.toThrow(
      ConfigError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("fallback", () => {
  it("is taken only when the primary has no key, and reports what changes", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    const bytes = Buffer.from("fallback mp3");
    useFetch(() => audioReply(bytes));

    const result = await runSpeech([
      "generate",
      "--provider",
      "gemini",
      "--fallback",
      "openai",
      "--text",
      "hi",
    ]);

    expect(posts("https://api.openai.com/v1/audio/speech")).toHaveLength(1);
    expect(posts("https://generativelanguage.googleapis.com")).toHaveLength(0);
    expect(result.group).toBe("openai");
    expect(result.model).toBe("gpt-4o-mini-tts");
    const data = result.data as {
      fallback: { from: string; reason: string; differences: string };
    };
    expect(data.fallback.from).toBe("gemini/gemini-3.8-flash-lite-tts");
    expect(data.fallback.reason).toContain("GEMINI_API_KEY is not set");
    expect(data.fallback.differences).toContain("voice Kore → marin");
    expect(data.fallback.differences).toContain("billing per character");
    expect(result.stderr.join("\n")).toContain(
      "Falling back from gemini/gemini-3.8-flash-lite-tts to openai/gpt-4o-mini-tts (--fallback)",
    );
  });

  it("skips every route without a key and uses the first one that has one", async () => {
    useEnv({ ELEVENLABS_API_KEY: "el-test-key" });
    useFetch(() => audioReply(Buffer.from("el mp3")));

    const result = await runSpeech([
      "generate",
      "--provider",
      "gemini",
      "--fallback",
      "openai",
      "--fallback",
      "elevenlabs",
      "--text",
      "hi",
    ]);

    expect(result.group).toBe("elevenlabs");
    expect(posts("https://api.elevenlabs.io/v1/text-to-speech/")).toHaveLength(1);
    expect(posts("https://api.openai.com")).toHaveLength(0);
    const data = result.data as { fallback: { reason: string } };
    expect(data.fallback.reason).toContain("GEMINI_API_KEY is not set");
    expect(data.fallback.reason).toContain("OPENAI_API_KEY is not set");
  });

  it("with no key on any route, the last route's ConfigError is thrown and nothing is sent", async () => {
    useEnv();
    await expect(
      runSpeech(["generate", "--provider", "gemini", "--fallback", "openai", "--text", "hi"]),
    ).rejects.toThrow("OPENAI_API_KEY is not set");
    expect(calls).toHaveLength(0);
  });

  it("a provider 500 is one POST and never moves to the fallback, even with --fallback", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai", ELEVENLABS_API_KEY: "el-test-key" });
    useFetch(() => jsonReply({ error: { message: "upstream exploded" } }, 500));

    await expect(
      runSpeech(["generate", "--provider", "openai", "--fallback", "elevenlabs", "--text", "hi"]),
    ).rejects.toBeInstanceOf(HttpError);

    expect(calls).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/audio/speech");
  });
});

describe("validation happens before any request", () => {
  it("a voice from another provider is rejected even with the key set", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    await expect(
      runSpeech([
        "generate",
        "--provider",
        "openai",
        "--model",
        "tts-1",
        "--voice",
        "marin",
        "--text",
        "hi",
      ]),
    ).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it("a duplicate fallback and a stray --extra are rejected with no request", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    await expect(
      runSpeech(["generate", "--provider", "openai", "--fallback", "openai", "--text", "hi"]),
    ).rejects.toThrow(/repeats a route already in the plan/);
    await expect(
      runSpeech([
        "generate",
        "--provider",
        "openai",
        "--extra",
        "elevenlabs.stability=0.4",
        "--text",
        "hi",
      ]),
    ).rejects.toThrow(/names a provider this request does not use/);
    expect(calls).toHaveLength(0);
  });

  it("--text and --text-file together, or neither, are rejected", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    const file = path.join(tmp, "scene.txt");
    fs.writeFileSync(file, "From file.");
    await expect(
      runSpeech(["generate", "--provider", "openai", "--text", "a", "--text-file", file]),
    ).rejects.toThrow("Pass --text or --text-file, not both");
    await expect(runSpeech(["generate", "--provider", "openai"])).rejects.toThrow(
      "Text is required",
    );
    await expect(
      runSpeech(["generate", "--provider", "openai", "--text-file", path.join(tmp, "missing.txt")]),
    ).rejects.toThrow("--text-file not found");
    expect(calls).toHaveLength(0);
  });

  it("an --output extension that disagrees with --format is rejected with no request", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    await expect(
      runSpeech([
        "generate",
        "--provider",
        "openai",
        "--text",
        "hi",
        "--format",
        "wav",
        "--output",
        path.join(tmp, "clip.mp3"),
      ]),
    ).rejects.toThrow("--format wav does not match --output");
    expect(calls).toHaveLength(0);
  });

  it("--async on a model that returns audio at once is rejected with no request", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    await expect(
      runSpeech(["generate", "--provider", "openai", "--async", "--text", "hi"]),
    ).rejects.toThrow(/returns audio in the same request; drop --async/);
    expect(calls).toHaveLength(0);
  });

  it("sends an ElevenLabs --voice named like an Object.prototype key verbatim", async () => {
    useEnv({ ELEVENLABS_API_KEY: "el-test-key" });
    useFetch(() => audioReply(Buffer.from("el mp3")));
    await runSpeech([
      "generate",
      "--provider",
      "elevenlabs",
      "--voice",
      "constructor",
      "--text",
      "hi",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/text-to-speech/constructor?");
  });

  it("rejects an --output extension that is not an audio container it writes", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    useFetch(() => audioReply(Buffer.from("mp3 bytes")));
    await expect(
      runSpeech([
        "generate",
        "--provider",
        "openai",
        "--text",
        "hi",
        "--output",
        path.join(tmp, "clip.m4a"),
      ]),
    ).rejects.toThrow(ValidationError);
    expect(calls).toHaveLength(0);
  });
});

describe("async submission", () => {
  it("atlas --async reports the job id and the resume command", async () => {
    useEnv({ ATLASCLOUD_API_KEY: "atlas-test-key" });
    useFetch((call) =>
      call.method === "POST" && call.url === ATLAS_SUBMIT
        ? jsonReply({ code: 200, data: { id: "pred_123", status: "starting" } })
        : jsonReply({ message: "not found" }, 404),
    );

    const result = await runSpeech(["generate", "--provider", "atlas", "--async", "--text", "hi"]);

    expect(result.data).toMatchObject({
      job: { id: "pred_123", resume: "multix atlas status pred_123 --wait --download" },
    });
    // The job id is printed once, by the provider runner.
    expect(result.stdout).toEqual(["pred_123"]);
    expect(result.stderr.join("\n")).toContain(
      "Resume with: multix atlas status pred_123 --wait --download",
    );
    expect(posts(ATLAS_SUBMIT)).toHaveLength(1);
  });
});

describe("provenance and output", () => {
  it("records the routed provider and model and the saved file's bytes", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    const bytes = Buffer.from("provenance mp3 bytes");
    useFetch(() => audioReply(bytes));
    const target = path.join(tmp, "copies", "scene.mp3");

    const result = await runSpeech([
      "generate",
      "--provider",
      "openai",
      "--model",
      "tts-1",
      "--voice",
      "alloy",
      "--text",
      "hi",
      "--output",
      target,
    ]);

    expect(result.group).toBe("openai");
    expect(result.model).toBe("tts-1");
    const data = result.data as {
      route: { provider: string; model: string; voice: string };
      files: string[];
    };
    expect(data.route).toMatchObject({ provider: "openai", model: "tts-1", voice: "alloy" });
    expect(data.files).toHaveLength(1);
    const saved = fs.readFileSync(data.files[0] as string);
    expect(sha256(saved)).toBe(sha256(bytes));
    expect(fs.readFileSync(target)).toEqual(bytes);
    // The envelope's outputs come from the same file inspection.
    expect(inspectOutput(data.files[0] as string, []).sha256).toBe(sha256(bytes));
    expect(result.stdout).toContain(`Copied to: ${target}`);
  });

  it("a model without a provider routes to its one provider and says so", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    useFetch(() => audioReply(Buffer.from("x")));

    const result = await runSpeech([
      "generate",
      "--model",
      "tts-1",
      "--voice",
      "alloy",
      "--text",
      "hi",
    ]);

    expect(result.group).toBe("openai");
    expect(result.data).toMatchObject({ route: { provider: "openai", provider_inferred: true } });
  });

  it("--text-file is read, trimmed and hashed into the request record", async () => {
    useEnv({ OPENAI_API_KEY: "sk-test-openai" });
    useFetch(() => audioReply(Buffer.from("x")));
    const file = path.join(tmp, "scene.txt");
    fs.writeFileSync(file, "  Hello from a file.\n");

    const result = await runSpeech(["generate", "--provider", "openai", "--text-file", file]);

    expect((calls[0]?.body as { input: string }).input).toBe("Hello from a file.");
    expect(result.data).toMatchObject({
      request: {
        text_chars: 18,
        text_sha256: sha256(Buffer.from("Hello from a file.")),
      },
    });
  });

  it("minimax --language vi is sent as language_boost Vietnamese", async () => {
    useEnv({ MINIMAX_API_KEY: "mm-test-key" });
    useFetch(() =>
      jsonReply({
        data: { audio: Buffer.from("mp3").toString("hex") },
        base_resp: { status_code: 0 },
      }),
    );

    await runSpeech([
      "generate",
      "--provider",
      "minimax",
      "--language",
      "vi",
      "--text",
      "xin chào",
    ]);

    expect((calls[0]?.body as { language_boost: string }).language_boost).toBe("Vietnamese");
  });
});
