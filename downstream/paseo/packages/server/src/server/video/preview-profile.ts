import type { EditPlanDraftV1 } from "#video-editor/contracts/v1";
import { editorFailure } from "./errors.js";

/** Keep unverified operations out of approvals and re-check persisted plans before dispatch. */
export function assertRenderablePreview(draft: EditPlanDraftV1): void {
  const unsupported = [
    draft.transformOperations,
    draft.audioOperations,
    draft.transitionOperations,
    draft.subtitleOperations,
    draft.generationRequests,
    draft.qaRequirements,
    draft.externalDestinations,
  ];
  if (
    draft.preferredDeterministicBackendId === "filmcraft" ||
    draft.trimOperations.length !== 1 ||
    unsupported.some((ops) => ops.length > 0)
  )
    editorFailure("CAPABILITY_UNAVAILABLE", "This preview profile supports one FFmpeg trim only");
  const { sourceRange, recordRange } = draft.trimOperations[0]!;
  const a = sourceRange.duration;
  const b = recordRange.duration;
  if (
    BigInt(recordRange.start.num) !== 0n ||
    BigInt(a.num) * BigInt(b.den) !== BigInt(b.num) * BigInt(a.den)
  )
    editorFailure(
      "CAPABILITY_UNAVAILABLE",
      "Timeline gaps and retiming are not supported by this preview profile",
    );
}
