import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { EditorAccessStore } from "./access.js";

// Complements access.test.ts: covers the remaining fail-closed branches — an
// unknown invitation id and activePrincipal for an unknown device.

it("fails closed on an unknown invitation id and an unknown device principal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "video-access-extra-"));
  try {
    const access = new EditorAccessStore(root);
    await access.initialize();
    await expect(
      access.redeemInvitation("no-such-invitation", "whatever"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(() => access.activePrincipal("no-such-device")).toThrow(/not active/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});