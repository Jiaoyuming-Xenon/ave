import type { EditPlanDraftV1, ProjectSnapshot } from "../shared/contracts/v1.js";

// The editor accepts seconds with millisecond precision, never frame numbers derived from FPS.
function milliseconds(value: string): bigint {
  const match = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new Error("请输入非负秒数，最多三位小数。");
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? "").padEnd(3, "0"));
}

export interface CaptionCue {
  text: string;
  start: string;
  end: string;
}

export function proposeCut(
  project: ProjectSnapshot,
  assetId: string,
  start: string,
  end: string,
  caption?: CaptionCue,
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
    subtitleOperations: caption
      ? [
          {
            opId: "sub-1",
            order: "1",
            trackId: "s1",
            clipId: "clip-1",
            cueId: "cue-1",
            range: {
              start: { num: milliseconds(caption.start).toString(), den: "1000" },
              duration: { num: (milliseconds(caption.end) - milliseconds(caption.start)).toString(), den: "1000" },
            },
            text: caption.text.slice(0, 16_384),
            mode: "burn-in" as const,
          },
        ]
      : [],
    generationRequests: [],
    qaRequirements: [],
    externalDestinations: [],
    maxCostMicros: "0",
  };
}

/** Delete the middle range [cutStart, cutEnd) and concatenate the rest: two contiguous trims. */
export function proposeCutOut(
  project: ProjectSnapshot,
  assetId: string,
  cutStart: string,
  cutEnd: string,
  totalSeconds: string,
): EditPlanDraftV1 {
  const asset = project.assets.find((a) => a.assetId === assetId);
  const stream = asset?.streams.find((s) => s.kind === "video");
  if (!asset || !stream) throw new Error("请选择含视频流的素材。");
  const from = milliseconds(cutStart);
  const to = milliseconds(cutEnd);
  const total = milliseconds(totalSeconds);
  if (to <= from) throw new Error("删除终点必须晚于删除起点。");
  if (total <= to) throw new Error("素材总长必须大于删除终点。");
  const ms = (v: bigint) => ({ num: v.toString(), den: "1000" });
  const head = { num: from.toString(), den: "1000" };
  const tailDuration = total - to;
  const tailStart = { num: to.toString(), den: "1000" };
  const base = proposeCut(project, assetId, "0", "0.001");
  return {
    ...base,
    intent: `删除 ${asset.displayName} 的 ${cutStart.trim()}–${cutEnd.trim()} 秒并拼接前后段`,
    trimOperations: [
      {
        opId: "trim-head",
        order: "1",
        trackId: "v1",
        clipId: "clip-head",
        source: base.trimOperations[0]!.source,
        sourceRange: { start: ms(0n), duration: head },
        recordRange: { start: ms(0n), duration: head },
      },
      {
        opId: "trim-tail",
        order: "2",
        trackId: "v1",
        clipId: "clip-tail",
        source: base.trimOperations[0]!.source,
        sourceRange: { start: tailStart, duration: ms(tailDuration) },
        recordRange: { start: head, duration: ms(tailDuration) },
      },
    ],
  };
}
