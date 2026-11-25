import { mkdtemp, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ContentAddressedStore } from "./cas.js";

it("returns a legitimate final partial range but never pads a truncated review artifact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "video-cas-range-"));
  try {
    const cas = new ContentAddressedStore(root);
    await cas.initialize();
    const ref = await cas.writeBytes(Buffer.from("abcdef"), "application/octet-stream");
    expect(await cas.readRange(ref, 4n, 32n)).toEqual(Buffer.from("ef"));
    await truncate(cas.pathFor(ref), 5);
    await expect(cas.readRange(ref, 4n, 32n)).rejects.toMatchObject({
      code: "ARTIFACT_HASH_MISMATCH",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
