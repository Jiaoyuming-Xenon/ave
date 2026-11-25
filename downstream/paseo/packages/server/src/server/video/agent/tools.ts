import { z } from "zod";
import {
  EditPlanDraftV1Schema,
  ProjectRequestSchema,
  type VideoToolCallSchema,
} from "#video-editor/contracts/v1";
import { DaemonToWorkerSchema, newRequestId, type DaemonToWorker, type IpcChannel } from "./ipc.js";

type VideoToolCall = z.infer<typeof VideoToolCallSchema>;

/** The planner may only inspect and propose. The daemon validates every call. */
export interface PlannerTool {
  description: string;
  parameters: unknown;
  execute: (toolCallId: string, args: unknown) => Promise<unknown>;
}

const assetArgs = z.object({ assetId: z.string().min(1), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const jobArgs = z.object({ jobId: z.string().min(1) }).strict();

/**
 * Build the closed tool set exposed to the Pi session. Every call crosses the
 * IPC boundary as a VideoToolCall envelope; the daemon re-validates and binds
 * projectId/runId/principal before dispatching to the VideoToolBroker.
 */
export function createPlannerTools(
  channel: IpcChannel<z.infer<typeof DaemonToWorkerSchema>, unknown>,
): Record<string, PlannerTool> {
  const call = async (tool: VideoToolCall["tool"], toolCallId: string, args: unknown) => {
    const requestId = newRequestId();
    const reply = await channel.request({
      kind: "tool_call",
      requestId,
      call: { protocolVersion: "1", toolCallId, tool, args } as never,
    } as DaemonToWorker);
    const result = reply as { ok: boolean; result?: unknown; error?: { code: string; message: string } };
    if (!result.ok) {
      const error = new Error(result.error?.message ?? "tool call failed");
      (error as Error & { code?: string }).code = result.error?.code ?? "TOOL_FAILED";
      throw error;
    }
    return result.result;
  };

  return {
    get_project_snapshot: {
      description:
        "Read the bound project snapshot: current revision, base asset manifest hash and asset identities. Never mutates.",
      parameters: ProjectRequestSchema,
      execute: (toolCallId, args) =>
        call("get_project_snapshot", toolCallId, ProjectRequestSchema.parse(args)),
    },
    get_asset_metadata: {
      description:
        "Read ffprobe/stream metadata for one asset by assetId + contentHash. The hash must match the project manifest.",
      parameters: assetArgs,
      execute: (toolCallId, args) => call("get_asset_metadata", toolCallId, assetArgs.parse(args)),
    },
    get_job_status: {
      description:
        "Read the real daemon state of a preview/final/export job. Never infers completion from tool events.",
      parameters: jobArgs,
      execute: (toolCallId, args) => call("get_job_status", toolCallId, jobArgs.parse(args)),
    },
    validate_edit_plan: {
      description:
        "Validate a candidate EditPlan against the schema and business rules. Read-only; does not persist anything.",
      parameters: EditPlanDraftV1Schema,
      execute: (toolCallId, args) => call("validate_edit_plan", toolCallId, EditPlanDraftV1Schema.parse(args)),
    },
    submit_edit_plan: {
      description:
        "Submit the final EditPlan for approval. Returns planId/planHash with status proposed; terminates the run. " +
        "This only proposes — it never approves, renders or exports.",
      parameters: EditPlanDraftV1Schema,
      execute: (toolCallId, args) => call("submit_edit_plan", toolCallId, EditPlanDraftV1Schema.parse(args)),
    },
  };
}
