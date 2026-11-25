import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  EditorPrincipal,
  StartPlanningRunInput,
  SteerPlanningRunInput,
} from "#video-editor/contracts/v1";
import { editorFailure } from "../errors.js";
import type { EditorStore } from "../store.js";
import { VideoToolBroker } from "../tool-broker.js";
import {
  DaemonToWorkerSchema,
  IpcChannel,
  WorkerToDaemonSchema,
  type DaemonToWorker,
  type WorkerToDaemon,
} from "./ipc.js";
import { videoPlannerPromptSignature } from "./prompt.js";

export interface PlanningRunStatus {
  runId: string;
  projectId: string;
  sessionId: string;
  state: "running" | "awaiting_input" | "settled" | "interrupted" | "failed";
  workerPid?: number;
}

interface RunHandle {
  projectId: string;
  runId: string;
  sessionId: string;
  principal: EditorPrincipal;
  child: ChildProcess;
  channel: IpcChannel<WorkerToDaemon, DaemonToWorker>;
  broker: VideoToolBroker;
  initialPrompt?: string;
  state: PlanningRunStatus["state"];
  workerPid?: number;
}

/**
 * Daemon-side controller for independent agent-worker processes. One child
 * process per planning run; the daemon owns the store, CAS, grants and the
 * VideoToolBroker, and persists every worker event through the store so
 * clients can resume with get_events(afterSeq) after reconnect.
 */
export class AgentRunController {
  private readonly runs = new Map<string, RunHandle>();

  constructor(private readonly store: EditorStore) {}

  /** Mark runs that were active when the daemon stopped as interrupted. */
  reconcile(projectIds: string[], principal: EditorPrincipal): void {
    for (const projectId of projectIds) {
      const states = this.store.runLifecycle(projectId, principal);
      for (const entry of states) {
        if (entry.state === "started" || entry.state === "running" || entry.state === "awaiting_input") {
          this.store.recordExternalEvent(
            projectId,
            "run.interrupted",
            { runId: entry.runId, reason: "daemon restarted; planning runs are never blindly replayed" },
            principal,
          );
        }
      }
    }
  }

  async startRun(input: StartPlanningRunInput, principal: EditorPrincipal) {
    this.store.authorizeProject(input.projectId, principal, "operator");
    if (input.model) editorFailure("CAPABILITY_UNAVAILABLE", "Explicit model selection is not configured");
    const { receipt, created } = this.store.reservePlanningRun(input.projectId, input.requestId, input.prompt, principal);
    if (!created) return receipt;
    const { runId, sessionId } = receipt;
    const entry = path.join(fileURLToPath(new URL(".", import.meta.url)));
    const workerJs = path.join(entry, "worker-main.js");
    const useTsx = !existsSync(workerJs);
    const child = useTsx
      ? spawn("npx", ["--no-install", "tsx", workerJs.replace(/\.js$/, ".ts")], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn(process.execPath, [workerJs], { stdio: ["pipe", "pipe", "pipe"] });

    const handle: RunHandle = {
      projectId: input.projectId,
      runId,
      sessionId,
      principal,
      initialPrompt: input.prompt,
      child,
      channel: undefined as never,
      broker: new VideoToolBroker(this.store, { projectId: input.projectId, runId, principal }),
      state: "running",
    };

    const channel = new IpcChannel<WorkerToDaemon, DaemonToWorker>(
      child.stdout!,
      child.stdin!,
      WorkerToDaemonSchema,
    );
    handle.channel = channel;
    channel.setHandler((message) => void this.onWorkerMessage(handle, message));

    child.on("exit", (code) => {
      if (handle.state === "running") {
        handle.state = "failed";
        this.store.recordExternalEvent(
          handle.projectId,
          "run.failed",
          { runId, exitCode: code },
          handle.principal,
        );
      }
      this.runs.delete(runId);
    });

    channel.sendValidated(
      {
        kind: "init",
        protocolVersion: "1",
        projectId: input.projectId,
        runId,
        sessionId,
        promptSignature: videoPlannerPromptSignature(),
      },
      DaemonToWorkerSchema,
    );

    this.runs.set(runId, handle);

    return { runId, projectId: input.projectId, sessionId, state: "running" as const };
  }

  private async onWorkerMessage(handle: RunHandle, message: WorkerToDaemon): Promise<void> {
    switch (message.kind) {
      case "hello":
        if (handle.initialPrompt === undefined || message.runId !== handle.runId ||
            message.sessionId !== handle.sessionId || handle.state !== "running") break;
        handle.workerPid = message.workerPid;
        handle.channel.send({ kind: "prompt", text: handle.initialPrompt });
        delete handle.initialPrompt;
        break;
      case "tool_call": {
        try {
          const result = await Promise.resolve(handle.broker.invoke(message.call));
          handle.channel.sendValidated(
            { kind: "tool_result", requestId: message.requestId, ok: true, result },
            DaemonToWorkerSchema,
          );
        } catch (error) {
          const failure = error as { code?: string; message?: string };
          handle.channel.sendValidated(
            {
              kind: "tool_result",
              requestId: message.requestId,
              ok: false,
              error: { code: failure.code ?? "TOOL_FAILED", message: failure.message ?? "tool failed" },
            },
            DaemonToWorkerSchema,
          );
        }
        break;
      }
      case "event":
        this.store.recordExternalEvent(
          handle.projectId,
          message.event.type,
          { ...((message.event.payload as object) ?? {}), workerEventId: message.event.eventId },
          handle.principal,
        );
        break;
      case "run_state":
        handle.state = message.state;
        this.store.recordExternalEvent(
          handle.projectId,
          `run.${message.state}`,
          { runId: handle.runId, detail: message.detail },
          handle.principal,
        );
        break;
    }
  }

  private handle(runId: string, projectId: string): RunHandle {
    const handle = this.runs.get(runId);
    if (!handle || handle.projectId !== projectId) editorFailure("NOT_FOUND", "No such planning run");
    return handle;
  }

  steer(input: SteerPlanningRunInput, principal: EditorPrincipal) {
    const handle = this.handle(input.runId, input.projectId);
    this.store.authorizeProject(input.projectId, principal, "operator");
    handle.channel.send({ kind: "steer", text: input.text });
    return { projectId: input.projectId, runId: input.runId, state: handle.state };
  }

  followUp(input: SteerPlanningRunInput, principal: EditorPrincipal) {
    const handle = this.handle(input.runId, input.projectId);
    this.store.authorizeProject(input.projectId, principal, "operator");
    handle.channel.send({ kind: "follow_up", text: input.text });
    return { projectId: input.projectId, runId: input.runId, state: handle.state };
  }

  async stopRun(
    projectId: string,
    runId: string,
    principal: EditorPrincipal,
  ): Promise<PlanningRunStatus> {
    const handle = this.handle(runId, projectId);
    this.store.authorizeProject(projectId, principal, "operator");
    handle.channel.send({ kind: "abort" });
    handle.channel.send({ kind: "dispose" });
    handle.state = "interrupted";
    this.store.recordExternalEvent(
      projectId,
      "run.interrupted",
      { runId, reason: "stopped by operator" },
      principal,
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      handle.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return { runId, projectId, sessionId: handle.sessionId, state: "interrupted" };
  }

  status(projectId: string, runId: string, principal: EditorPrincipal): PlanningRunStatus {
    const handle = this.runs.get(runId);
    this.store.authorizeProject(projectId, principal, "viewer");
    if (!handle || handle.projectId !== projectId)
      editorFailure("NOT_FOUND", "No active planning run (it may have settled; see events)");
    return {
      runId,
      projectId,
      sessionId: handle.sessionId,
      state: handle.state,
      workerPid: handle.workerPid,
    };
  }

  async disposeAll(): Promise<void> {
    for (const handle of [...this.runs.values()]) {
      handle.channel.send({ kind: "abort" });
      handle.channel.send({ kind: "dispose" });
      handle.child.kill("SIGTERM");
    }
    this.runs.clear();
  }
}
