import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EditorPrincipal } from "#video-editor/contracts/v1";
import { expect, it } from "vitest";
import { ContentAddressedStore } from "./cas.js";
import { EditorJobSupervisor } from "./jobs.js";
import { EditorStore } from "./store.js";

const owner: EditorPrincipal = { principalId: "owner", role: "owner", projectIds: null };

it("cancelling a finished job emits exactly one state event", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "job-events-"));
  const store = await EditorStore.create(root);
  const cas = new ContentAddressedStore(path.join(root, "cas"));
  await cas.initialize();
  try {
    const project = store.createProject({
      requestId: "create",
      title: "Event count",
      principal: owner,
    });
    const blob = await cas.writeBytes(Buffer.from("fixture"), "video/mp4");
    await store.addAsset(
      project.projectId,
      {
        assetId: blob.sha256,
        original: blob,
        displayName: "source.mp4",
        streams: [
          {
            streamUid: "stream:0",
            streamIndex: 0,
            kind: "video",
            codec: "h264",
            timeBase: { num: "1", den: "30" },
            disposition: {},
          },
        ],
        presentationIndex: blob,
        probe: blob,
        sourceNeverWritable: true,
      },
      "asset",
      owner,
    );
    const current = store.project(project.projectId, owner);
    const { approval } = store.createPlan({
      requestId: "plan",
      runId: "run",
      toolCallId: "tool",
      principal: owner,
      draft: {
        schemaVersion: "video.edit-plan/v1",
        projectId: project.projectId,
        baseTimelineRevision: current.revision,
        baseAssetManifestHash: current.baseAssetManifestHash,
        intent: "Trim one second",
        trimOperations: [
          {
            opId: "trim-1",
            order: "1",
            trackId: "v1",
            clipId: "clip-1",
            source: {
              assetId: blob.sha256,
              assetContentHash: blob.sha256,
              streamUid: "stream:0",
              probeRevision: "1",
            },
            sourceRange: { start: { num: "0", den: "1" }, duration: { num: "1", den: "1" } },
            recordRange: { start: { num: "0", den: "1" }, duration: { num: "1", den: "1" } },
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
      },
    });
    const { grant } = store.decideApproval(
      {
        requestId: "approve",
        approvalId: approval.approvalId,
        expectedRevision: current.revision,
        decision: "approve",
      },
      owner,
    );
    const { job } = store.createJob({
      requestId: "job",
      projectId: project.projectId,
      approvalId: approval.approvalId,
      grantId: grant!.grantId,
      expectedRevision: current.revision,
      principal: owner,
    });
    store.updateJob(project.projectId, job.jobId, snapshot => ({ ...snapshot, state: "awaiting_review" }));
    const initial = store.events(project.projectId, "0", owner).events;
    const before = BigInt(initial.at(-1)?.seq ?? "0");
    const supervisor = new EditorJobSupervisor(store, {
      executeJob: async () => {
        throw new Error("no media execution expected");
      },
    } as unknown as ConstructorParameters<typeof EditorJobSupervisor>[1]);
    const cancel = () => supervisor.control(project.projectId, job.jobId, "cancel", "cancel-finished", owner);
    const first = cancel();
    const after = store.events(project.projectId, before.toString(), owner);
    expect(after.events.map(event => event.payload)).toEqual([
      expect.objectContaining({ jobId: job.jobId, state: "cancelled" }),
    ]);
    expect(first.state).toBe("cancelled");
    expect(cancel()).toEqual(first);
    expect(store.events(project.projectId, before.toString(), owner)).toEqual(after);
    expect(store.job(project.projectId, job.jobId, owner)).toEqual(first);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
