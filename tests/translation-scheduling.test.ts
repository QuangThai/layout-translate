import { describe, expect, it } from "vitest";
import {
  buildTranslationGroups,
  chunkItems,
  runChunksWithConcurrency,
  TRANSLATION_CHUNK_SIZE,
  TRANSLATION_CONCURRENCY,
} from "../src/content/translation-engine";
import type { ComponentKind } from "../src/shared/contracts";

function record(
  anchorId: string,
  source: string,
  top: number | null,
  component: ComponentKind = "navigation",
) {
  return { anchorId, source, component, top };
}

describe("translation grouping", () => {
  it("sends one request per repeated string and applies it to every member", () => {
    const groups = buildTranslationGroups([
      record("a1", "会社情報", 10),
      record("a2", "保存する", 20),
      record("a3", "会社情報", 30),
      record("a4", "会社情報", 40),
    ], 800);

    expect(groups).toHaveLength(2);
    const repeated = groups.find((group) => group.request.source === "会社情報");
    expect(repeated?.request.anchorId).toBe("a1");
    expect(repeated?.members.map((member) => member.anchorId)).toEqual(["a1", "a3", "a4"]);
  });

  it("keeps the same string separate when its component policy differs", () => {
    const groups = buildTranslationGroups([
      record("a1", "詳細", 10, "navigation"),
      record("a2", "詳細", 20, "table"),
    ], 800);

    expect(groups).toHaveLength(2);
  });

  it("translates what the reader can already see before the rest of the page", () => {
    const groups = buildTranslationGroups([
      record("below", "下", 2_400),
      record("visible-bottom", "中", 700),
      record("above", "上", -300),
      record("visible-top", "先", 40),
    ], 800);

    expect(groups.map((group) => group.request.anchorId)).toEqual([
      "visible-top",
      "visible-bottom",
      "above",
      "below",
    ]);
  });

  it("orders detached elements last instead of dropping them", () => {
    const groups = buildTranslationGroups([
      record("detached", "非表示", null),
      record("visible", "表示", 100),
    ], 800);

    expect(groups.map((group) => group.request.anchorId)).toEqual(["visible", "detached"]);
    expect(groups).toHaveLength(2);
  });
});

describe("chunked concurrency", () => {
  it("keeps batches small enough to render before the whole page returns", () => {
    expect(TRANSLATION_CHUNK_SIZE).toBeLessThan(50);
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkItems([], 2)).toEqual([]);
  });

  it("runs chunks in parallel without exceeding the concurrency limit", async () => {
    const chunks = Array.from({ length: 9 }, (_value, index) => index);
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    const run = runChunksWithConcurrency(chunks, TRANSLATION_CONCURRENCY, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      completed.push(item);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(TRANSLATION_CONCURRENCY);

    while (releases.length) releases.shift()?.();
    for (let tick = 0; tick < 20; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (releases.length) releases.shift()?.();
    }

    await run;
    expect(completed.sort((left, right) => left - right)).toEqual(chunks);
    expect(peak).toBeLessThanOrEqual(TRANSLATION_CONCURRENCY);
  });

  it("stops scheduling and lets in-flight work settle before reporting failure", async () => {
    const started: number[] = [];
    const settled: number[] = [];

    await expect(runChunksWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (item === 0) throw new Error("batch failed");
      settled.push(item);
    })).rejects.toThrow("batch failed");

    // The sibling worker's chunk finished, and nothing new was scheduled after
    // the failure, so the caller can roll back a known set of rendered records.
    expect(settled).toEqual([1]);
    expect(started).toEqual([0, 1]);
  });

  it("reports the first failure rather than the last", async () => {
    await expect(runChunksWithConcurrency([0, 1], 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item === 0 ? 1 : 10));
      throw new Error(`failure-${item}`);
    })).rejects.toThrow("failure-0");
  });
});
