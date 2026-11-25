import type { EditPlanDraftV1, Rational } from "#video-editor/contracts/v1";
import { editorFailure } from "./errors.js";

function rationalEquals(a: Rational, b: Rational): boolean {
  return BigInt(a.num) * BigInt(b.den) === BigInt(b.num) * BigInt(a.den);
}

function rationalAdd(a: Rational, b: Rational): Rational {
  return {
    num: (BigInt(a.num) * BigInt(b.den) + BigInt(b.num) * BigInt(a.den)).toString(),
    den: (BigInt(a.den) * BigInt(b.den)).toString(),
  };
}

/**
 * Keep unverified operations out of approvals and re-check persisted plans before dispatch.
 * The preview profile supports contiguous multi-segment trims over one video stream of one
 * asset: record ranges tile [0, total) in order and no segment is retimed.
 */
export function assertRenderablePreview(draft: EditPlanDraftV1): void {
  const unsupported = [
    draft.transformOperations,
    draft.transitionOperations,
    draft.generationRequests,
    draft.qaRequirements,
    draft.externalDestinations,
  ];
  if (
    draft.preferredDeterministicBackendId === "filmcraft" ||
    unsupported.some((ops) => ops.length > 0)
  )
    editorFailure("CAPABILITY_UNAVAILABLE", "This preview profile supports FFmpeg trims only");
  if (draft.audioOperations.length > 64)
    editorFailure("CAPABILITY_UNAVAILABLE", "At most 64 audio operations per plan");
  for (const op of draft.audioOperations)
    if (op.source.assetId !== draft.trimOperations[0]?.source.assetId)
      editorFailure(
        "CAPABILITY_UNAVAILABLE",
        "Audio operations must target the same asset as the trims",
      );
  if (draft.subtitleOperations.length > 64 || draft.subtitleOperations.some((op) => op.mode !== "burn-in"))
    editorFailure(
      "CAPABILITY_UNAVAILABLE",
      "This preview profile supports burn-in subtitles only (max 64 cues)",
    );
  const ops = draft.trimOperations;
  if (ops.length === 0)
    editorFailure("CAPABILITY_UNAVAILABLE", "At least one trim operation is required");
  const first = ops[0]!;
  let cursor: Rational = { num: "0", den: "1" };
  for (const op of ops) {
    if (!rationalEquals(op.recordRange.start, cursor))
      editorFailure(
        "CAPABILITY_UNAVAILABLE",
        "Timeline gaps or overlaps are not supported by this preview profile",
      );
    if (!rationalEquals(op.sourceRange.duration, op.recordRange.duration))
      editorFailure(
        "CAPABILITY_UNAVAILABLE",
        "Retiming is not supported by this preview profile",
      );
    cursor = rationalAdd(cursor, op.recordRange.duration);
  }
}
