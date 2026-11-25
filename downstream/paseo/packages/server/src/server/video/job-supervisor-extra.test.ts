import type { JobSnapshot } from "#video-editor/contracts/v1";
import { expect, it } from "vitest";
import { EditorJobSupervisor } from "./jobs.js";

// Complements job-supervisor.test.ts: covers the enqueue dedup guard (a job already
// running is not queued twice) and the execute no-op for terminal/awaiting/paused
// states (re-enqueue without a control transition never launches media).

type JobState = JobSnapshot["state"];
type StoreParam = ConstructorParameters<typeof EditorJobSupervisor>[0];
type MediaParam = ConstructorParameters<typeof EditorJobSupervisor>[1];

function makeJob(state: JobState): JobSnapshot {
  return { jobId: "job", projectId: "project", revision: "1", planHash: "a".repeat(64), kind: "preview", state, artifacts: [] };
}

function harness(initial: JobState) {
  let current = makeJob(initial);
  let executions = 0;
  const store = {
    controlJob: () => ({ job: current, applied: false }),
    job: () => current,
    updateJob(_p: string, _j: string, update: (job: JobSnapshot) => JobSnapshot) {
      current = update(current);
      return current;
    },
  };
  const media = {
    async executeJob() { executions++; return current; },
  };
  const supervisor = new EditorJobSupervisor(store as unknown as StoreParam, media as unknown as MediaParam);
  return { supervisor, executions: () => executions, state: () => current.state };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

it("a duplicate enqueue while a job is running launches only one worker", async () => {
  const h = harness("rendering_preview");
  h.supervisor.enqueue("project", "job");
  h.supervisor.enqueue("project", "job");
  await tick();
  await tick();
  expect(h.executions()).toBe(1);
});

it.each(["completed", "failed", "cancelled", "awaiting_review", "awaiting_delivery_approval", "paused"] as const)(
  "re-enqueue of a %s job is a no-op (no media execution)",
  async (state) => {
    const h = harness(state);
    h.supervisor.enqueue("project", "job");
    await tick();
    await tick();
    expect(h.executions()).toBe(0);
    expect(h.state()).toBe(state);
  },
);