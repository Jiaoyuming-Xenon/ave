import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ContentAddressedStore, sha256Json } from "./cas.js";

// Complements cas.test.ts: pins sha256Json (the deterministic digest used for
// planner request ids and asset manifests) and the readRange argument guards.

it("sha256Json is the SHA-256 of the canonical JSON.stringify bytes", () => {
  const value = { reportId: "r1", subjectHash: "a".repeat(64) };
  expect(sha256Json(value)).toBe(createHash("sha256").update(JSON.stringify(value)).digest("hex"));
  expect(sha256Json(value)).toBe(sha256Json({ ...value }));
  expect(sha256Json([1, 2, 3])).toMatch(/^[0-9a-f]{64}$/);
  // JSON.stringify preserves insertion order, so key order changes the digest.
  expect(sha256Json({ a: 1, b: 2 })).not.toBe(sha256Json({ b: 2, a: 1 }));
});

it("readRange rejects negative offset, non-positive length and offset past EOF", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "video-cas-range-guard-"));
  try {
    const cas = new ContentAddressedStore(root);
    await cas.initialize();
    const ref = await cas.writeBytes(Buffer.from("abcdef"), "application/octet-stream");
    await expect(cas.readRange(ref, -1n, 1n)).rejects.toMatchObject({ code: "RANGE_NOT_SATISFIABLE" });
    await expect(cas.readRange(ref, 0n, 0n)).rejects.toMatchObject({ code: "RANGE_NOT_SATISFIABLE" });
    await expect(cas.readRange(ref, 0n, -1n)).rejects.toMatchObject({ code: "RANGE_NOT_SATISFIABLE" });
    await expect(cas.readRange(ref, 6n, 1n)).rejects.toMatchObject({ code: "RANGE_NOT_SATISFIABLE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});