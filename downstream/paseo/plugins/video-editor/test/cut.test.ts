import { describe, expect, it } from "vitest";
import { proposeCut } from "../client/cut.js";
import type { ProjectSnapshot } from "../shared/contracts/v1.js";

const project = {
  projectId: "p1",
  revision: "1",
  baseAssetManifestHash: "a".repeat(64),
  assets: [
    {
      assetId: "asset-1",
      displayName: "clip.mp4",
      original: { sha256: "b".repeat(64) },
      streams: [{ kind: "video", streamUid: "stream:0" }],
    },
  ],
} as unknown as ProjectSnapshot;

describe("proposeCut", () => {
  it("builds a millisecond-precision trim draft bound to the project revision", () => {
    const draft = proposeCut(project, "asset-1", "1.5", "4.05");
    const op = draft.trimOperations[0]!;
    expect(op.sourceRange).toEqual({
      start: { num: "1500", den: "1000" },
      duration: { num: "2550", den: "1000" },
    });
    expect(op.recordRange.start).toEqual({ num: "0", den: "1" });
    expect(op.recordRange.duration).toEqual({ num: "2550", den: "1000" });
    expect(op.source).toMatchObject({
      assetId: "asset-1",
      assetContentHash: "b".repeat(64),
      streamUid: "stream:0",
    });
    expect(draft.baseTimelineRevision).toBe("1");
    expect(draft.baseAssetManifestHash).toBe("a".repeat(64));
    expect(draft.intent).toContain("clip.mp4");
  });

  it("rejects an out-point not later than the in-point", () => {
    expect(() => proposeCut(project, "asset-1", "2", "2")).toThrow("出点必须晚于入点");
    expect(() => proposeCut(project, "asset-1", "3", "2")).toThrow("出点必须晚于入点");
  });

  it("rejects malformed or negative seconds and excess precision", () => {
    for (const bad of ["abc", "-1", "1.2345", ""]) {
      expect(() => proposeCut(project, "asset-1", bad, "2")).toThrow("非负秒数");
    }
  });

  it("rejects an asset without a video stream", () => {
    expect(() => proposeCut(project, "missing", "0", "1")).toThrow("含视频流");
  });
});