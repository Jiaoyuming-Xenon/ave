import { createAgentSession } from "@earendil-works/pi-coding-agent";
import type { EditorEvent } from "#video-editor/contracts/v1";
import { randomUUID } from "node:crypto";
import { VIDEO_PLANNER_PROMPT, videoPlannerPromptSignature } from "./prompt.js";
import { createPlannerTools } from "./tools.js";
import type { DaemonToWorker, IpcChannel, WorkerToDaemon } from "./ipc.js";

export interface PlannerSessionOptions {
  projectId: string;
  runId: string;
  sessionId: string;
  workspace: string;
  model: { provider: string; id: string };
  /** SHA-256 of VIDEO_PLANNER_PROMPT supplied by the daemon at init. */
  promptSignature: string;
  channel: IpcChannel<DaemonToWorker, WorkerToDaemon>;
  onEvent: (event: EditorEvent) => void;
}

interface PiSession {
  prompt(text: string): Promise<unknown>;
  steer(text: string): Promise<unknown>;
  followUp(text: string): Promise<unknown>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
  subscribe(listener: (event: unknown) => void): void;
}

/**
 * Create the locked-down planner session. The session runs with noTools:"all"
 * plus only the closed customTools set; the ResourceLoader returns no
 * extensions, skills, prompt templates, themes, context files or MCP servers,
 * and the system prompt is the pinned VIDEO_PLANNER_PROMPT. The daemon-supplied
 * prompt signature must match the compiled-in constant, so the prompt can
 * never be swapped by tool output, files, MCP or extensions. The worker cwd
 * is a host-owned empty workspace, never the source or asset root.
 */
export async function createPlannerSession(options: PlannerSessionOptions) {
  if (options.promptSignature !== videoPlannerPromptSignature()) {
    throw new Error("VIDEO_PLANNER_PROMPT signature mismatch; refusing to start the worker");
  }

  const tools = createPlannerTools(options.channel);
  const customTools = Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        description: tool.description,
        parameters: tool.parameters,
        execute: (toolCallId: string, args: unknown) => tool.execute(toolCallId, args),
      },
    ]),
  );

  const resourceLoader = {
    async load() {
      return { systemPrompt: VIDEO_PLANNER_PROMPT, resources: [], extensions: [] };
    },
  };

  const session = (await createAgentSession({
    cwd: options.workspace,
    model: options.model,
    tools: { noTools: "all", customTools },
    resourceLoader,
  })) as unknown as PiSession;

  let seq = 0;
  const emitPiEvent = (piEvent: unknown) => {
    const e = piEvent as { type?: string; id?: string; toolCallId?: string };
    const type = typeof e?.type === "string" ? e.type : "agent.unknown";
    if (type === "tool_execution_start" || type === "message_end" || type === "agent_end") {
      seq += 1;
      options.onEvent({
        protocolVersion: "1",
        projectId: options.projectId,
        sessionId: options.sessionId,
        runId: options.runId,
        eventId: typeof e?.id === "string" ? e.id : randomUUID(),
        seq: String(seq),
        causationId: typeof e?.toolCallId === "string" ? e.toolCallId : undefined,
        occurredAt: new Date().toISOString(),
        type: `agent.${type}`,
        payload: {},
      });
    }
  };
  session.subscribe(emitPiEvent);

  return {
    session,
    prompt: (text: string) => session.prompt(text),
    steer: (text: string) => session.steer(text),
    followUp: (text: string) => session.followUp(text),
    abort: () => session.abort(),
    dispose: () => session.dispose(),
  };
}
