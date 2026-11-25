import { VideoToolCallSchema, type EditorPrincipal } from "#video-editor/contracts/v1";
import { sha256Json } from "./cas.js";
import { editorFailure } from "./errors.js";
import type { EditorStore } from "./store.js";

export interface PlannerScope {
  projectId: string;
  runId: string;
  principal: EditorPrincipal;
}

/** Construct one per admitted run. Do not pass a generic RPC dispatcher to the worker. */
export class VideoToolBroker {
  constructor(
    private readonly store: EditorStore,
    private readonly scope: PlannerScope,
  ) {}

  invoke(message: unknown) {
    const parsed = VideoToolCallSchema.safeParse(message);
    if (!parsed.success) editorFailure("INVALID_ARGUMENT", "Invalid planner tool request");
    const call = parsed.data;
    const { projectId, runId, principal } = this.scope;
    if ("projectId" in call.args && call.args.projectId !== projectId)
      editorFailure("PERMISSION_DENIED", "The planner is bound to another project");
    switch (call.tool) {
      case "get_project_snapshot": {
        const p = this.store.project(projectId, principal);
        return {
          projectId,
          revision: p.revision,
          baseAssetManifestHash: p.baseAssetManifestHash,
          assetCount: p.assets.length,
          assets: p.assets
            .slice(0, 64)
            .map((a) => ({ assetId: a.assetId, contentHash: a.original.sha256 })),
          hasMoreAssets: p.assets.length > 64,
        };
      }
      case "get_asset_metadata": {
        const asset = this.store
          .project(projectId, principal)
          .assets.find((a) => a.assetId === call.args.assetId);
        if (!asset || asset.original.sha256 !== call.args.contentHash)
          editorFailure("ASSET_NOT_FOUND", "Asset identity is not in the bound project");
        return {
          assetId: asset.assetId,
          contentHash: asset.original.sha256,
          streams: asset.streams.map(
            ({ streamUid, kind, codec, timeBase, width, height, sampleRate }) => ({
              streamUid,
              kind,
              codec,
              timeBase,
              width,
              height,
              sampleRate,
            }),
          ),
        };
      }
      case "get_job_status": {
        const { jobId, kind, state, revision, progress } = this.store.job(
          projectId,
          call.args.jobId,
          principal,
        );
        return { jobId, kind, state, revision, progress };
      }
      case "validate_edit_plan":
        this.store.validateProposal(call.args, principal);
        return { valid: true };
      case "submit_edit_plan": {
        const { plan } = this.store.createPlan({
          runId,
          toolCallId: call.toolCallId,
          draft: call.args,
          principal,
          requestId: sha256Json([
            "video-planner",
            projectId,
            principal.principalId,
            runId,
            call.toolCallId,
          ]),
        });
        return { planId: plan.planId, planHash: plan.planHash, status: plan.status };
      }
    }
  }
}
