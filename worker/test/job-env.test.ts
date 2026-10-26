/**
 * jobEnv: the provider keys a job receives are the ones of its key groups only,
 * trimmed, and blank values are dropped. Speech jobs depend on this so a
 * gemini request never carries an openai key and vice versa.
 */

import { describe, expect, it } from "vitest";
import { jobEnv } from "../src/jobs/job-runner.js";
import type { ProviderKeys } from "../src/provider-secret-names.js";

const keys: ProviderKeys = {
  GEMINI_API_KEY: "g-test-key",
  OPENAI_API_KEY: "  sk-test-openai  ",
  ELEVENLABS_API_KEY: "el-test-key",
  MINIMAX_API_KEY: "mm-test-key",
  ATLASCLOUD_API_KEY: "atlas-test-key",
  FAL_KEY: "fal-test-key",
};

describe("jobEnv", () => {
  it("passes only the keys of the named groups, trimmed", () => {
    expect(jobEnv(["openai", "minimax"], keys)).toEqual({
      OPENAI_API_KEY: "sk-test-openai",
      MINIMAX_API_KEY: "mm-test-key",
    });
  });

  it("gives a job no key when no group is named (speech models)", () => {
    expect(jobEnv([], keys)).toEqual({});
  });

  it("gives nothing for a group that reads no key or is unknown", () => {
    expect(jobEnv(["media", "not-a-group"], keys)).toEqual({});
  });

  it("drops a blank or missing key rather than sending an empty value", () => {
    expect(
      jobEnv(["openai", "elevenlabs"], { OPENAI_API_KEY: "   ", ELEVENLABS_API_KEY: undefined }),
    ).toEqual({});
  });

  it("reads every key a speech route names and nothing it does not", () => {
    expect(jobEnv(["gemini", "elevenlabs", "atlas"], keys)).toEqual({
      GEMINI_API_KEY: "g-test-key",
      ELEVENLABS_API_KEY: "el-test-key",
      ATLASCLOUD_API_KEY: "atlas-test-key",
    });
  });
});
