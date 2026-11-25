import type { EditPlanDraftV1, ProjectSnapshot } from "../shared/contracts/v1.js";

// The editor accepts seconds with millisecond precision, never frame numbers derived from FPS.
function milliseconds(value: string): bigint {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new Error("请输入非负秒数，最多三位小数。");
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

export function proposeCut(
  project: ProjectSnapshot,
  assetId: string,
  start: string,
  end: string,
): EditPlanDraftV1 {
  const asset = project.assets.find((a) => a.assetId === assetId);
  const stream = asset?.streams.find((s) => s.kind === "video");
  if (!asset || !stream) throw new Error("请选择含视频流的素材。");
  const first = milliseconds(start);
  const last = milliseconds(end);
  if (last <= first) throw new Error("出点必须晚于入点。");
  const duration = { num: (last - first).toString(), den: "1000" };
  return {
    schemaVersion: "video.edit-plan/v1",
    projectId: project.projectId,
    baseTimelineRevision: project.revision,
    baseAssetManifestHash: project.baseAssetManifestHash,
    preferredDeterministicBackendId: "ffmpeg",
    intent: `保留 ${asset.displayName} 的 ${start.trim()}–${end.trim()} 秒`,
    trimOperations: [
      {
        opId: "trim-1",
        order: "1",
        trackId: "v1",
        clipId: "clip-1",
        source: {
          assetId,
          assetContentHash: asset.original.sha256,
          streamUid: stream.streamUid,
          probeRevision: "1",
        },
        sourceRange: { start: { num: first.toString(), den: "1000" }, duration },
        recordRange: { start: { num: "0", den: "1" }, duration },
      },
    ],
    transformOperations: [],
    audioOperations: [],
    transitionOperations: [],
    subtitleOperations: [],
    generationRequests: [],
    qaRequirements: [],
    externalDestinations: [],
    maxCostMicros: "0",
  };
}
