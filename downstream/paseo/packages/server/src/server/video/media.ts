import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { ContentAddressedStore, sha256File } from "./cas.js";
import { EditorError, editorFailure } from "./errors.js";
import { assertRenderablePreview } from "./preview-profile.js";
import { EditorStore } from "./store.js";
import {
  SourceAssetSchema,
  StreamDescriptorSchema,
  type AcceptedEditPlan,
  type BlobRef,
  type EditorPrincipal,
  type JobSnapshot,
  type Rational,
  type SourceAsset,
  type StreamDescriptor,
} from "#video-editor/contracts/v1";

const execFileAsync = promisify(execFile);

interface ProbeDocument {
  format: { duration?: string; start_time?: string; format_name?: string };
  streams: Array<{
    index: number;
    codec_type: string;
    codec_name?: string;
    profile?: string;
    time_base?: string;
    duration_ts?: number;
    start_pts?: number;
    avg_frame_rate?: string;
    width?: number;
    height?: number;
    sample_rate?: string;
    channels?: number;
    channel_layout?: string;
    color_space?: string;
    color_transfer?: string;
    color_primaries?: string;
    sample_aspect_ratio?: string;
    disposition?: Record<string, number>;
    tags?: Record<string, string>;
    side_data_list?: Array<{ side_data_type?: string; rotation?: number | string }>;
  }>;
  chapters?: unknown[];
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface MediaTools {
  ffmpeg: string;
  ffprobe: string;
}

export class MediaService {
  private readonly uploadsInFlight = new Map<string, Promise<void>>();

  private async withUpload<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.uploadsInFlight.get(id) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.uploadsInFlight.set(id, tail);
    try {
      return await result;
    } finally {
      if (this.uploadsInFlight.get(id) === tail) this.uploadsInFlight.delete(id);
    }
  }

  constructor(
    private readonly store: EditorStore,
    private readonly cas: ContentAddressedStore,
    private readonly tools: MediaTools = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
  ) {}

  private async prepareAsset(input: {
    assetId: string;
    displayName: string;
    existingBlob: BlobRef;
  }): Promise<SourceAsset> {
    const original = input.existingBlob;
    const source = this.cas.pathFor(original);
    const probed = await this.probe(source);
    const presentationIndex = await this.presentationIndex(original, probed.streams);
    const probe = await this.cas.writeJson(probed.document);
    const index = await this.cas.writeJson(presentationIndex);
    const proxy = await this.createProxy(source);
    return SourceAssetSchema.parse({
      assetId: input.assetId,
      original,
      displayName: input.displayName,
      streams: probed.streams,
      presentationIndex: index,
      probe,
      proxy,
      sourceNeverWritable: true,
    });
  }

  async executeJob(projectId: string, jobId: string, signal: AbortSignal): Promise<JobSnapshot> {
    const job = this.store.job(projectId, jobId, {
      principalId: "worker",
      role: "owner",
      projectIds: null,
    });
    this.store.updateJob(projectId, jobId, (current) => ({
      ...current,
      phaseDetail: "reading approved plan",
    }));
    const plan = await this.readPlan(projectId, job.planHash);
    const project = this.store.project(projectId, {
      principalId: "worker",
      role: "owner",
      projectIds: null,
    });
    if (job.kind === "export") return this.deliver(job, plan, signal);
    if (job.kind !== "preview" && job.kind !== "final")
      editorFailure("CAPABILITY_UNAVAILABLE", "Not a render job");
    const asset = project.assets.find((a) => a.assetId === plan.trimOperations[0]?.source.assetId);
    if (!asset || (await sha256File(this.cas.pathFor(asset.original))) !== asset.original.sha256)
      editorFailure("ARTIFACT_HASH_MISMATCH", "Source changed before render");
    const directory = await mkdtemp(path.join(tmpdir(), "video-render-"));
    let outputBlob: BlobRef;
    try {
      const output = path.join(directory, "candidate.mp4");
      await this.render(asset, plan, job.kind, output, signal);
      this.throwIfCancelled(signal);
      outputBlob = await this.cas.importFile(output, "video/mp4");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    const probe = await this.probe(this.cas.pathFor(outputBlob));
    await this.verifyCandidateDecode(outputBlob, signal);
    checkCandidate(probe.document, asset, plan, job.kind);
    const reviewProxy = job.kind === "final" ? await this.createFinalReviewProxy(outputBlob, signal) : undefined;
    if (reviewProxy) {
      checkCandidate((await this.probe(this.cas.pathFor(reviewProxy))).document, asset, plan, "preview");
      await this.verifyCandidateDecode(reviewProxy, signal);
    }
    const build = await this.run(this.tools.ffmpeg, ["-version"]);
    const qa = await this.cas.writeJson({
      ffmpegBuildHash: createHash("sha256").update(build.stdout).digest("hex"),
      reportId: job.jobId,
      subjectHash: outputBlob.sha256,
      reviewProxyHash: reviewProxy?.sha256,
      revision: job.candidateRevision,
      thresholdsVersion: "deterministic-v1",
      gates: [
        {
          gate: "G4",
          status: "passed",
          checks: [
            { name: "full_decode", status: "passed" },
            { name: "ffprobe", status: "passed" },
          ],
        },
        {
          gate: "G5",
          status: "manual_required",
          checks: [{ name: "human_review", status: "manual_required" }],
        },
      ],
      probe: probe.document,
    });
    this.throwIfCancelled(signal);
    const artifact = {
      artifactId: `${jobId}:candidate`,
      projectId,
      jobId,
      revision: job.revision,
      kind: "candidate" as const,
      blob: outputBlob,
    };
    return this.store.finishCandidate(job, artifact, {
      ...artifact,
      artifactId: `${jobId}:qa`,
      kind: "qa",
      blob: qa,
    }, reviewProxy && { ...artifact, artifactId: `${jobId}:review-proxy`, kind: "proxy", blob: reviewProxy });
  }

  private async deliver(
    job: JobSnapshot,
    plan: AcceptedEditPlan,
    signal: AbortSignal,
  ): Promise<JobSnapshot> {
    const { candidate, qa } = this.store.deliveryInputs(job);
    const report = JSON.parse((await this.cas.readBytes(qa.blob)).toString("utf8"));
    if (
      report.subjectHash !== candidate.blob.sha256 ||
      report.revision !== candidate.revision ||
      report.reportId !== candidate.jobId ||
      !report.gates.some(
        (g: { gate: string; status: string }) => g.gate === "G4" && g.status === "passed",
      )
    )
      editorFailure("QA_FAILED", "Report does not cover the reviewed output");
    if (
      !(await this.cas.has(candidate.blob)) ||
      (await sha256File(this.cas.pathFor(candidate.blob))) !== candidate.blob.sha256
    )
      editorFailure("ARTIFACT_HASH_MISMATCH", "Reviewed bytes changed before delivery");
    const manifest = await this.cas.writeJson({
      exportId: job.jobId,
      output: candidate.blob,
      sourceManifestHash: plan.baseAssetManifestHash,
      revision: candidate.revision,
      planHash: plan.planHash,
      ffmpegBuildHash: report.ffmpegBuildHash,
      modelRuns: [],
      maskLineageRoots: [],
      encoding: report.probe.streams,
      qaReport: report,
      approvalId: job.approvalId,
    });
    this.throwIfCancelled(signal);
    const output = {
      ...candidate,
      jobId: job.jobId,
      artifactId: `${job.jobId}:export`,
      kind: "export" as const,
    };
    return this.store.finishDelivery(job, output, {
      ...output,
      artifactId: `${job.jobId}:manifest`,
      kind: "manifest",
      blob: manifest,
    });
  }

  async writeUploadChunk(
    uploadId: string,
    offset: string,
    payload: Uint8Array,
    principal: EditorPrincipal,
  ): Promise<string> {
    return this.withUpload(uploadId, async () => {
      const upload = this.store.upload(uploadId);
      this.store.uploadStatus(upload.projectId, uploadId, principal);
      const end = BigInt(offset) + BigInt(payload.byteLength);
      if (
        !payload.byteLength ||
        payload.byteLength > 262144 ||
        end > BigInt(upload.expectedSize) ||
        end > BigInt(Number.MAX_SAFE_INTEGER)
      )
        editorFailure("INVALID_ARGUMENT", "Chunk exceeds the declared upload range");
      const digest = createHash("sha256").update(payload).digest("hex");
      const confirmed = this.store.confirmedChunkHash(uploadId, offset);
      if (confirmed === digest) return upload.nextOffset;
      if (confirmed || upload.nextOffset !== offset)
        editorFailure("IDEMPOTENCY_CONFLICT", "Chunk conflicts with the confirmed bytes or offset");
      await this.cas.writeUploadChunk(uploadId, BigInt(offset), payload);
      this.store.confirmChunk({ uploadId, offset, nextOffset: end.toString(), digest });
      return end.toString();
    });
  }

  async commitUpload(
    uploadId: string,
    requestId: string,
    finalSha256: string,
    principal: EditorPrincipal,
  ): Promise<SourceAsset> {
    return this.withUpload(uploadId, () =>
      this.commitConfirmedUpload(uploadId, requestId, finalSha256, principal),
    );
  }

  private async commitConfirmedUpload(
    uploadId: string,
    requestId: string,
    finalSha256: string,
    principal: EditorPrincipal,
  ): Promise<SourceAsset> {
    const receipt = this.store.committedUpload(uploadId, requestId, finalSha256, principal);
    if (receipt) {
      await this.cas.removeTemporary(uploadId);
      return receipt;
    }
    const upload = this.store.upload(uploadId);
    this.store.uploadStatus(upload.projectId, uploadId, principal);
    if (upload.nextOffset !== upload.expectedSize)
      editorFailure("ARTIFACT_HASH_MISMATCH", "Upload has unconfirmed bytes");
    if (upload.expectedSha256 !== finalSha256)
      editorFailure("ARTIFACT_HASH_MISMATCH", "The final hash differs from the upload declaration");
    const blob = await this.cas.commitUpload(
      uploadId,
      finalSha256,
      upload.expectedSize,
      upload.mediaType,
    );
    const asset = await this.prepareAsset({
      assetId: `asset-${uploadId}`,
      displayName: upload.displayName,
      existingBlob: blob,
    });
    const result = this.store.finishUpload(uploadId, asset, requestId, principal);
    await this.cas.removeTemporary(uploadId);
    return result;
  }

  async readPlan(projectId: string, planHash: string): Promise<AcceptedEditPlan> {
    const project = this.store.project(projectId, {
      principalId: "worker",
      role: "owner",
      projectIds: null,
    });
    const plan = project.plans.find((candidate) => candidate.planHash === planHash);
    if (!plan) editorFailure("PROJECT_NOT_FOUND", "The approved plan is unavailable");
    return plan;
  }

  private async probe(
    source: string,
  ): Promise<{ document: ProbeDocument; streams: StreamDescriptor[] }> {
    const { stdout } = await this.run(this.tools.ffprobe, [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-show_chapters",
      "-of",
      "json",
      source,
    ]);
    const document = JSON.parse(stdout) as ProbeDocument;
    const streams = document.streams.map((stream) => {
      if (!stream.time_base || !/^[1-9][0-9]*\/[1-9][0-9]*$/.test(stream.time_base)) {
        editorFailure("PLAN_SEMANTIC_INVALID", "The imported stream has no positive time base");
      }
      const rotation = stream.side_data_list?.find(
        (entry) => entry.rotation !== undefined,
      )?.rotation;
      return StreamDescriptorSchema.parse({
        streamUid: `stream:${stream.index}`,
        streamIndex: stream.index,
        kind: stream.codec_type,
        codec: stream.codec_name ?? "unknown",
        codecProfile: stream.profile,
        timeBase: parseRational(stream.time_base ?? "1/1"),
        averageRate:
          stream.avg_frame_rate && stream.avg_frame_rate !== "0/0"
            ? parseRational(stream.avg_frame_rate)
            : undefined,
        width: stream.width,
        height: stream.height,
        sampleRate: stream.sample_rate ? Number(stream.sample_rate) : undefined,
        channels: stream.channels,
        channelLayout: stream.channel_layout,
        language: stream.tags?.language,
        disposition: stream.disposition ?? {},
        color: compactRecord({
          space: stream.color_space,
          transfer: stream.color_transfer,
          primaries: stream.color_primaries,
        }),
        sampleAspectRatio: stream.sample_aspect_ratio,
        rotation: rotation === undefined ? undefined : String(rotation),
      });
    });
    if (!streams.some((stream) => stream.kind === "video" || stream.kind === "audio")) {
      editorFailure(
        "PLAN_SEMANTIC_INVALID",
        "The imported file has no supported audio or video stream",
      );
    }
    return { document, streams };
  }

  private async presentationIndex(
    original: BlobRef,
    streams: StreamDescriptor[],
  ): Promise<unknown> {
    const { stdout } = await this.run(
      this.tools.ffprobe,
      [
        "-v",
        "error",
        "-show_frames",
        "-show_entries",
        "frame=stream_index,media_type,key_frame,pts,best_effort_timestamp,duration,pkt_duration:frame_side_data=",
        "-of",
        "json",
        this.cas.pathFor(original),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    return {
      schemaVersion: "video.presentation-index/v2",
      sourceSha256: original.sha256,
      streams: streams.map(({ streamIndex, streamUid, timeBase }) => ({
        streamIndex,
        streamUid,
        timeBase,
      })),
      frames: parsePresentationFrames(stdout),
    };
  }

  private async createFinalReviewProxy(candidate: BlobRef, signal: AbortSignal): Promise<BlobRef> {
    const directory = await mkdtemp(path.join(tmpdir(), "final-review-"));
    try {
      const output = path.join(directory, "review.mp4");
      await this.spawnChecked(this.tools.ffmpeg, [
        "-nostdin", "-v", "error", "-xerror", "-i", this.cas.pathFor(candidate),
        "-map", "0:v:0", "-map", "0:a:0?", "-vf", "scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1",
        "-fps_mode", "vfr", "-enc_time_base:v", "filter", "-c:v", "libx264", "-crf", "27", "-pix_fmt", "yuv420p",
        "-c:a", "copy", "-movflags", "+faststart", output,
      ], signal);
      return await this.cas.importFile(output, "video/mp4");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async createProxy(source: string): Promise<BlobRef> {
    const directory = await mkdtemp(path.join(tmpdir(), "video-proxy-"));
    const output = path.join(directory, "proxy.mp4");
    try {
      await this.run(this.tools.ffmpeg, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        source,
        "-map",
        "0:v:0",
        "-vf",
        "scale='min(640,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "27",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
        output,
      ]);
      return await this.cas.importFile(output, "video/mp4");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async render(
    asset: SourceAsset,
    plan: AcceptedEditPlan,
    kind: "preview" | "final",
    output: string,
    signal: AbortSignal,
  ): Promise<void> {
    assertRenderablePreview(plan);
    if (plan.deterministicBackendId !== "ffmpeg")
      editorFailure("CAPABILITY_UNAVAILABLE", "The approved backend is unavailable");
    const op = plan.trimOperations[0]!;
    const video = asset.streams.find(
      (s) => s.streamUid === op.source.streamUid && s.kind === "video",
    );
    const audio = asset.streams.filter((s) => s.kind === "audio");
    if (!video || audio.length > 1 || asset.streams.length !== audio.length + 1)
      editorFailure(
        "CAPABILITY_UNAVAILABLE",
        "Only one video and at most one audio stream are supported",
      );
    const range = `start=${rationalSeconds(op.sourceRange.start)}:duration=${rationalSeconds(op.sourceRange.duration)}`;
    const preview =
      kind === "preview"
        ? ",scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1"
        : "";
    const args = [
      "-v",
      "error",
      "-xerror",
      "-nostdin",
      "-i",
      this.cas.pathFor(asset.original),
      "-map",
      `0:${video.streamIndex}`,
      "-vf",
      `trim=${range},setpts=PTS-STARTPTS${preview}`,
      "-fps_mode",
      "vfr",
      ...(kind === "preview" ? ["-enc_time_base:v", "filter"] : []),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
    ];
    if (audio[0])
      args.push(
        "-map",
        `0:${audio[0].streamIndex}`,
        "-af",
        `atrim=${range},asetpts=PTS-STARTPTS`,
        "-c:a",
        "aac",
        "-ar",
        "48000",
      );
    args.push("-movflags", "+faststart", output);
    await this.spawnChecked(this.tools.ffmpeg, args, signal);
  }

  async verifyCandidateDecode(candidate: BlobRef, signal: AbortSignal): Promise<void> {
    await this.spawnChecked(
      this.tools.ffmpeg,
      ["-v", "error", "-xerror", "-nostdin", "-i", this.cas.pathFor(candidate), "-map", "0", "-f", "null", "-"],
      signal,
    );
  }

  private async run(
    command: string,
    args: string[],
    options: { maxBuffer?: number } = {},
  ): Promise<ProcessResult> {
    try {
      return await execFileAsync(command, args, {
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        windowsHide: true,
      });
    } catch {
      throw new EditorError("UPSTREAM_UNAVAILABLE", "The media inspection tool failed", true);
    }
  }

  private spawnChecked(command: string, args: string[], signal: AbortSignal): Promise<void> {
    this.throwIfCancelled(signal);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stderr.resume();
      const cancel = () => child.kill("SIGTERM");
      signal.addEventListener("abort", cancel, { once: true });
      child.once("error", () => {
        signal.removeEventListener("abort", cancel);
        reject(new EditorError("UPSTREAM_UNAVAILABLE", "The media worker could not start", true));
      });
      child.once("close", (code) => {
        signal.removeEventListener("abort", cancel);
        if (signal.aborted)
          return reject(new EditorError("CANCELLED", "The media job was cancelled"));
        if (code !== 0)
          return reject(
            new EditorError("QA_FAILED", "FFmpeg rejected the edit or produced an invalid output"),
          );
        resolve();
      });
    });
  }

  private throwIfCancelled(signal: AbortSignal): void {
    if (signal.aborted) editorFailure("CANCELLED", "The media job was cancelled");
  }
}

export function assertCandidateAudio(
  source: ReadonlyArray<Pick<StreamDescriptor, "kind" | "channels">>,
  output: ReadonlyArray<Pick<ProbeDocument["streams"][number], "codec_type" | "codec_name" | "sample_rate" | "channels">>,
): void {
  const expected = source.filter(stream => stream.kind === "audio");
  const actual = output.filter(stream => stream.codec_type === "audio");
  if (actual.length !== expected.length || actual.some((stream, index) => {
    const channels = expected[index]?.channels;
    return stream.codec_name !== "aac" || stream.sample_rate !== "48000" ||
      !stream.channels || (channels !== undefined && stream.channels !== channels);
  })) editorFailure("QA_FAILED", "Candidate audio tracks differ from the approved render profile");
}

function checkCandidate(
  doc: ProbeDocument,
  asset: SourceAsset,
  plan: AcceptedEditPlan,
  kind: "preview" | "final",
): void {
  const video = doc.streams.find((s) => s.codec_type === "video");
  const source = asset.streams.find((s) => s.kind === "video");
  const width = kind === "final" ? source?.width : 640;
  const height = kind === "final" ? source?.height : 360;
  if (
    !video ||
    video.codec_name !== "h264" ||
    video.width !== width ||
    video.height !== height ||
    doc.streams.length !== asset.streams.length
  )
    editorFailure("QA_FAILED", "Unexpected candidate streams or dimensions");
  assertCandidateAudio(asset.streams, doc.streams);
  const dur = plan.trimOperations[0]!.recordRange.duration;
  for (const s of doc.streams) {
    if (!s.time_base || !Number.isSafeInteger(s.duration_ts) || s.start_pts !== 0)
      editorFailure("QA_FAILED", "Missing or invalid candidate timeline");
    const base = parseRational(s.time_base);
    const error =
      BigInt(s.duration_ts!) * BigInt(base.num) * BigInt(dur.den) -
      BigInt(dur.num) * BigInt(base.den);
    if (error !== 0n)
      editorFailure("QA_FAILED", "Candidate stream duration differs from the approved trim");
  }
}

const frameTickFields = new Set(["pts", "best_effort_timestamp", "duration", "pkt_duration"]);

export function parsePresentationFrames(json: string): unknown[] {
  // ffprobe emits int64 ticks as JSON numbers. Use the JSON token, not its rounded JS value.
  const document: unknown = JSON.parse(
    json,
    (key: string, value: unknown, context?: { source?: string }) => {
      if (!frameTickFields.has(key)) return value;
      const token = context?.source;
      if (typeof value !== "number" || typeof token !== "string" || !/^-?[0-9]+$/.test(token)) {
        editorFailure("QA_FAILED", "No exact integer token for a probed frame time");
      }
      return token;
    },
  );
  if (
    !document ||
    typeof document !== "object" ||
    !("frames" in document) ||
    !Array.isArray(document.frames)
  ) {
    editorFailure("QA_FAILED", "No decoded frame list in probe output");
  }
  return document.frames;
}

function parseRational(value: string): Rational {
  const [num, den] = value.split("/");
  return { num: num ?? "0", den: den ?? "1" };
}

function rationalSeconds(value: Rational): string {
  const numerator = BigInt(value.num);
  const denominator = BigInt(value.den);
  if (denominator === 0n)
    editorFailure("PLAN_SEMANTIC_INVALID", "A rational time has a zero denominator");
  const sign = numerator < 0n ? "-" : "";
  const absolute = numerator < 0n ? -numerator : numerator;
  const whole = absolute / denominator;
  const remainder = absolute % denominator;
  return `${sign}${whole}.${((remainder * 1_000_000_000n) / denominator).toString().padStart(9, "0")}`;
}

function compactRecord(
  values: Record<string, string | undefined>,
): Record<string, string> | undefined {
  const entries = Object.entries(values).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
