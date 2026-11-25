import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentAddressedStore } from "./cas.js";
import { EditorError } from "./errors.js";
import { EditorStore } from "./store.js";
import type { EditorPrincipal } from "#video-editor/contracts/v1";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const owner: EditorPrincipal = { principalId: "owner", role: "owner", projectIds: null };
const viewer: EditorPrincipal = { principalId: "viewer", role: "viewer", projectIds: null };

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "editor-store-"));
  roots.push(root);
  const store = await EditorStore.create(root);
  const cas = new ContentAddressedStore(path.join(root, "cas"));
  await cas.initialize();
  const project = store.createProject({
    requestId: "create",
    title: "Real media",
    principal: owner,
  });
  return { root, store, cas, project };
}

function draft(project: ReturnType<EditorStore["createProject"]>, requestId = "plan") {
  const asset = project.assets[0]!;
  return {
    requestId,
    runId: "run",
    toolCallId: "tool",
    principal: owner,
    draft: {
      schemaVersion: "video.edit-plan/v1" as const,
      projectId: project.projectId,
      baseTimelineRevision: project.revision,
      baseAssetManifestHash: project.baseAssetManifestHash,
      intent: "Trim one second",
      trimOperations: [
        {
          opId: "trim-1",
          order: "1",
          trackId: "v1",
          clipId: "clip-1",
          source: {
            assetId: asset.assetId,
            assetContentHash: asset.original.sha256,
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
  };
}

describe("EditorStore durable workflow", () => {
  it("replays creation and enforces viewer read-only project access", async () => {
    const { store, project, cas } = await fixture();
    const blob = await cas.writeBytes(Buffer.from("viewer-test"), "video/mp4");
    await store.addAsset(
      project.projectId,
      {
        assetId: blob.sha256,
        original: blob,
        displayName: "source",
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
    expect(
      store.createProject({ requestId: "create", title: "Real media", principal: owner }),
    ).toEqual(project);
    expect(() =>
      store.createProject({ requestId: "create", title: "Different", principal: owner }),
    ).toThrow(EditorError);
    store.registerDevice({
      projectId: project.projectId,
      principalId: viewer.principalId,
      role: "viewer",
      actor: owner,
    });
    expect(store.project(project.projectId, viewer).projectId).toBe(project.projectId);
    expect(() => store.createPlan({ ...draft(current), principal: viewer })).toThrow(
      "This operation requires operator access",
    );
    store.registerDevice({
      projectId: project.projectId,
      principalId: viewer.principalId,
      role: "operator",
      actor: owner,
    });
    expect(() => store.validateProposal(draft(current).draft, viewer)).toThrow(
      "This operation requires operator access",
    );
    expect(store.projectSummary(project.projectId, viewer)).toEqual({
      projectId: project.projectId,
      title: current.title,
      revision: current.revision,
    });
    expect(() => store.project("not-a-project", owner)).toThrow("The project does not exist");
    store.close();
  });

  it("persists a rejected preview without granting or starting work on replay", async () => {
    const f = await fixture();
    let store = f.store;
    try {
      const blob = await f.cas.writeBytes(Buffer.from("approval-state fixture"), "video/mp4");
      const projectId = f.project.projectId;
      await store.addAsset(projectId, {
        assetId: "source", original: blob, displayName: "fixture.mp4",
        streams: [{ streamUid: "stream:0", streamIndex: 0, kind: "video", codec: "h264", timeBase: { num: "1", den: "25" }, disposition: {} }],
        presentationIndex: blob, probe: blob, sourceNeverWritable: true,
      }, "asset", owner);
      const before = store.project(projectId, owner);
      const { approval } = store.createPlan(draft(before));
      const decision = { approvalId: approval.approvalId, expectedRevision: before.revision, requestId: `reject-${approval.approvalId}`, decision: "reject" as const };
      const result = store.decideApproval(decision, owner);
      expect(result.approval.status).toBe("rejected");
      expect(result.grant).toBeUndefined();
      const after = store.project(projectId, owner);
      expect(after.jobs).toHaveLength(0);
      expect(after.approvals).toEqual([result.approval]);
      store.close();
      store = await EditorStore.create(f.root);
      expect(store.decideApproval(decision, owner)).toEqual(result);
      expect(() => store.decideApproval({...decision, requestId: "late-approve", decision: "approve"}, owner)).toThrow("already been decided");
      expect(store.project(projectId, owner)).toEqual(after);
    } finally {
      store.close();
    }
  });

  it("creates a plan, consumes its approval once and replays the same job request", async () => {
    const { store, cas, project } = await fixture();
    const blob = await cas.writeBytes(Buffer.from("not-a-video"), "video/mp4");
    const asset = {
      assetId: blob.sha256,
      original: blob,
      displayName: "source.mp4",
      streams: [
        {
          streamUid: "stream:0",
          streamIndex: 0,
          kind: "video" as const,
          codec: "h264",
          timeBase: { num: "1", den: "30" },
          disposition: {},
        },
      ],
      presentationIndex: blob,
      probe: blob,
      sourceNeverWritable: true as const,
    };
    await store.addAsset(project.projectId, asset, "asset", owner);
    const current = store.project(project.projectId, owner);
    const { plan, approval } = store.createPlan(draft(current));
    expect(plan.status).toBe("proposed");
    expect(store.createPlan(draft(current))).toEqual({ plan, approval });
    expect(() =>
      store.createJob({
        requestId: "job",
        projectId: current.projectId,
        approvalId: approval.approvalId,
        grantId: "invalid",
        expectedRevision: current.revision,
        principal: owner,
      }),
    ).toThrow("grant does not belong");
    const approved = store.decideApproval(
      {
        requestId: "approve",
        approvalId: approval.approvalId,
        expectedRevision: current.revision,
        decision: "approve",
      },
      owner,
    );
    const grant = approved.grant!;
    const created = store.createJob({
      requestId: "job",
      projectId: current.projectId,
      approvalId: approval.approvalId,
      grantId: grant.grantId,
      expectedRevision: current.revision,
      principal: owner,
    });
    expect(created.deduplicated).toBe(false);
    expect(created.job.state).toBe("rendering_preview");
    expect(
      store.createJob({
        requestId: "job",
        projectId: current.projectId,
        approvalId: approval.approvalId,
        grantId: grant.grantId,
        expectedRevision: current.revision,
        principal: owner,
      }),
    ).toEqual(created);
    expect(() =>
      store.decideApproval(
        {
          requestId: "approve-again",
          approvalId: approval.approvalId,
          expectedRevision: current.revision,
          decision: "approve",
        },
        owner,
      ),
    ).toThrow("already been decided");
    expect(store.events(current.projectId, "0", owner).events.length).toBeGreaterThan(0);
    store.close();
  });

  it("marks an active job interrupted on restart without completing its artifacts", async () => {
    const { store, cas, project, root } = await fixture();
    const blob = await cas.writeBytes(Buffer.from("fixture"), "video/mp4");
    await store.addAsset(
      project.projectId,
      {
        assetId: blob.sha256,
        original: blob,
        displayName: "fixture",
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
    const { approval } = store.createPlan(draft(current));
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
      projectId: current.projectId,
      approvalId: approval.approvalId,
      grantId: grant!.grantId,
      expectedRevision: current.revision,
      principal: owner,
    });
    store.close();
    const reopened = await EditorStore.create(root);
    expect(reopened.job(project.projectId, job.jobId, owner)).toMatchObject({
      state: "failed",
      artifacts: [],
      error: { code: "NEEDS_RECONCILIATION", retryable: true },
    });
    reopened.close();
  });
});

describe("listProjects", () => {
  it("owner sees every project; a paired device sees only its scoped grants", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "editor-list-"));
    roots.push(root);
    const store = await EditorStore.create(root);
    const a = store.createProject({ requestId: "a", title: "A", principal: owner });
    const b = store.createProject({ requestId: "b", title: "B", principal: owner });
    expect(store.listProjects(owner).map((p) => p.projectId).sort()).toEqual(
      [a.projectId, b.projectId].sort(),
    );
    store.registerDevice({ projectId: a.projectId, principalId: "device-1", role: "viewer", actor: owner });
    const device: EditorPrincipal = { principalId: "device-1", role: "viewer", projectIds: [a.projectId] };
    expect(store.listProjects(device)).toEqual([
      { projectId: a.projectId, title: "A", revision: a.revision },
    ]);
    // A grant outside the credential's scope is still filtered out.
    store.registerDevice({ projectId: b.projectId, principalId: "device-1", role: "viewer", actor: owner });
    expect(store.listProjects(device).map((p) => p.projectId)).toEqual([a.projectId]);
    // An unpaired principal sees nothing.
    const stranger: EditorPrincipal = { principalId: "nobody", role: "viewer", projectIds: null };
    expect(store.listProjects(stranger)).toEqual([]);
    store.close();
  });
});

describe("controlJob terminal matrix", () => {
  it("pause/resume/cancel reach the right states with and without a worker and emit events", async () => {
    const { store, cas, project } = await fixture();
    const blob = await cas.writeBytes(Buffer.from("fixture"), "video/mp4");
    await store.addAsset(
      project.projectId,
      {
        assetId: blob.sha256,
        original: blob,
        displayName: "fixture",
        streams: [
          { streamUid: "stream:0", streamIndex: 0, kind: "video", codec: "h264", timeBase: { num: "1", den: "30" }, disposition: {} },
        ],
        presentationIndex: blob,
        probe: blob,
        sourceNeverWritable: true,
      },
      "asset",
      owner,
    );
    const current = store.project(project.projectId, owner);
    const { approval } = store.createPlan(draft(current));
    const { grant } = store.decideApproval(
      { requestId: "approve", approvalId: approval.approvalId, expectedRevision: current.revision, decision: "approve" },
      owner,
    );
    const { job } = store.createJob({
      requestId: "job",
      projectId: current.projectId,
      approvalId: approval.approvalId,
      grantId: grant!.grantId,
      expectedRevision: current.revision,
      principal: owner,
    });
    expect(job.state).toBe("rendering_preview");
    const control = (action: "pause" | "resume" | "cancel", requestId: string, hasWorker: boolean) =>
      store.controlJob({ projectId: current.projectId, jobId: job.jobId, action, requestId, principal: owner }, hasWorker);
    // No worker: pause finalizes straight to paused, resume re-queues the start state.
    expect(control("pause", "pause", false).job.state).toBe("paused");
    expect(control("resume", "resume", false).job.state).toBe("rendering_preview");
    // With a worker: pause only requests a safe checkpoint.
    expect(control("pause", "pause-worker", true).job.state).toBe("pausing");
    // No worker: cancel finalizes straight to cancelled even from a requested state.
    expect(control("cancel", "cancel", false).job.state).toBe("cancelled");
    expect(() => control("cancel", "cancel-again", false)).toThrow("already finished");
    const states = store
      .events(current.projectId, "0", owner)
      .events.filter((e) => e.type === "job.state.changed")
      .map((e) => (e.payload as { state: string }).state);
    expect(states).toEqual(
      expect.arrayContaining(["rendering_preview", "paused", "pausing", "cancelled"]),
    );
    store.close();
  });
});

describe("events cursor and isolation", () => {
  it("filters by afterSeq, keeps per-project seq monotonic, and isolates projects", async () => {
    const { store, project } = await fixture();
    const second = store.createProject({ requestId: "second", title: "Second", principal: owner });

    const all = store.events(project.projectId, "0", owner).events;
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.projectId === project.projectId)).toBe(true);
    const seqs = all.map((e) => Number(e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    // Cursor at the latest seq yields nothing further.
    const lastSeq = all[all.length - 1]!.seq;
    expect(store.events(project.projectId, lastSeq, owner).events).toHaveLength(0);
    // Cursor before the first event yields everything.
    expect(store.events(project.projectId, "0", owner).events.length).toBe(all.length);

    // The second project's events never leak into the first project's stream.
    const secondEvents = store.events(second.projectId, "0", owner).events;
    expect(secondEvents.every((e) => e.projectId === second.projectId)).toBe(true);
    expect(secondEvents.some((e) => e.projectId === project.projectId)).toBe(false);
    store.close();
  });
});
