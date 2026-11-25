import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { EditorAccessStore } from "./access.js";

it("pairs a scoped device, notifies listeners on revoke, and refuses the credential afterwards", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "video-access-"));
  try {
    const access = new EditorAccessStore(root);
    await access.initialize();
    const invitation = await access.createInvitation({ role: "operator", projectIds: ["project-a"] });
    const issued = await access.redeemInvitation(invitation.invitationId, invitation.token);
    expect(issued.principal).toEqual({
      principalId: issued.deviceId,
      role: "operator",
      projectIds: ["project-a"],
    });
    // A replayed invitation cannot mint a second credential.
    await expect(
      access.redeemInvitation(invitation.invitationId, invitation.token),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(access.authenticate(issued.deviceId, issued.credential).role).toBe("operator");

    const revoked: string[] = [];
    const unsubscribe = access.onRevoke((deviceId) => revoked.push(deviceId));
    await access.revoke(issued.deviceId);
    expect(revoked).toEqual([issued.deviceId]);
    expect(() => access.authenticate(issued.deviceId, issued.credential)).toThrow(
      /invalid or revoked/,
    );
    expect(() => access.activePrincipal(issued.deviceId)).toThrow(/not active/);
    unsubscribe();
    await expect(access.revoke(issued.deviceId)).resolves.toBeUndefined();
    expect(revoked).toEqual([issued.deviceId]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("survives a reload and keeps a revoked device revoked", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "video-access-reload-"));
  try {
    const first = new EditorAccessStore(root);
    await first.initialize();
    const invitation = await first.createInvitation({ role: "viewer", projectIds: ["p"] });
    const issued = await first.redeemInvitation(invitation.invitationId, invitation.token);
    await first.revoke(issued.deviceId);

    const reloaded = new EditorAccessStore(root);
    await reloaded.initialize();
    expect(() => reloaded.authenticate(issued.deviceId, issued.credential)).toThrow(
      /invalid or revoked/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});