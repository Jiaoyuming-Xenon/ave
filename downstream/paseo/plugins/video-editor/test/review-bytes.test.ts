import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { encodeFramedChunk } from "../shared/bytes.js";
import { readReviewBytes } from "../client/review-bytes.js";

const bytes = new Uint8Array(262145).fill(71);
const sum = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const selected = {projectId:"project",assetId:"job:candidate",revision:"7",blob:{sha256:sum(bytes),bytes:String(bytes.length),mediaType:"video/mp4"}};
const hash = async (data: ArrayBuffer) => sum(new Uint8Array(data));

it.each(["manifest", "export"] as const)("reads only delivered %s bytes with matching identity and type", async purpose => {
  const payload = purpose === "manifest" ? new TextEncoder().encode('{"exportId":"job"}') : bytes.subarray(0, 29);
  const blob = { bytes: String(payload.length), sha256: sum(payload), mediaType: purpose === "manifest" ? "application/json" : "video/mp4" };
  const item = { ...selected, assetId: `job:${purpose}`, blob };
  const signal = new AbortController().signal;
  const frame = encodeFramedChunk({ protocolVersion: "1", offset: "0", bytesLength: blob.bytes, totalBytes: blob.bytes,
    revision: item.revision, chunkSha256: blob.sha256, assetSha256: blob.sha256 }, payload);
  let requests = 0;
  const read = async (request: {assetId: string}) => { requests++; expect(request.assetId).toBe(item.assetId); return frame; };
  expect(new Uint8Array(await readReviewBytes(item, read, hash, signal, purpose))).toEqual(payload);
  await expect(readReviewBytes({...item, assetId: "job:candidate"}, read, hash, signal, purpose)).rejects.toThrow("不是已交付");
  await expect(readReviewBytes({...item, blob: {...blob, mediaType:"text/html"}}, read, hash, signal, purpose)).rejects.toThrow("格式不匹配");
  expect(requests).toBe(1);
});

it.each(["valid", "wrong revision", "damaged chunk", "wrong complete hash"] as const)("verifies preview bytes: %s", async mode => {
  const offsets: string[] = [];
  const read = readReviewBytes(selected, async request => {
    expect(request.assetId).toBe(selected.assetId);
    offsets.push(request.offset);
    const payload = bytes.slice(Number(request.offset), Number(request.offset)+Number(request.length));
    const originalChunk = sum(payload);
    if(mode === "damaged chunk" || mode === "wrong complete hash") payload[0] ^= 1;
    return encodeFramedChunk({protocolVersion:"1",offset:request.offset,bytesLength:request.length,totalBytes:selected.blob.bytes,revision:mode === "wrong revision" ? "8" : "7",assetSha256:selected.blob.sha256,chunkSha256:mode === "wrong complete hash" ? sum(payload) : originalChunk},payload);
  }, hash, new AbortController().signal);
  if(mode === "valid") {
    expect(new Uint8Array(await read)).toEqual(bytes);
    expect(offsets).toEqual(["0","262144"]);
  } else {
    await expect(read).rejects.toThrow(mode === "wrong complete hash" ? "文件校验失败" : "分块与所选版本不符");
  }
});
