"""Repeat the local pillow edit on the first nine images of SAM2's bedroom example."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
from check_vace_shot import digest, encode_rgb, media, probe_frames, check_pts, save_conditions, verify_model
from protected_composite import composite_rgb24
from vace_shot import VaceCanvas, generate_shot

CANVAS = VaceCanvas((960, 540), (832, 480))
PROMPT = "A bright turquoise decorative linen pillow on the right side of a bed, realistic woven fabric, soft daylight, bedroom home video."
NEGATIVE = "beige pillow, pink pillow, extra objects, text, blurry"
SEED = 732022
REGION = (515, 275, 706, 423)
POINTS = ((607, 355, True), (485, 365, False), (598, 264, False))


def prepare(source, weights, out):
    from check_sam2_shot import FramePrompt, Point, PROFILES, SOURCE_REV, track_shot

    revision = subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip()
    if (revision != SOURCE_REV or subprocess.check_output(["git", "-C", source, "status", "--porcelain"])
            or digest(weights) != PROFILES["tiny"][1]):
        raise ValueError("SAM2 checkout or weights differ from pinned Tiny profile")
    sys.path.insert(0, str(source))
    from sam2.build_sam import build_sam2_video_predictor
    out.mkdir(parents=True, exist_ok=False)
    frames = out / "frames"
    frames.mkdir()
    for i in range(9):
        name = f"{i:05d}.jpg"
        (frames / name).symlink_to(source / "notebooks/videos/bedroom" / name)
    predictor = build_sam2_video_predictor("configs/sam2.1/sam2.1_hiera_t.yaml", str(weights))
    predictor.fill_hole_area = 0
    prompts = [FramePrompt(0, tuple(Point(*p) for p in POINTS))]
    masks = dict(track_shot(predictor, frames, 9, prompts))
    replay = dict(track_shot(predictor, frames, 9, prompts))
    rows = []
    for i, mask in sorted(masks.items()):
        if not np.array_equal(mask, replay[i]) or mask[355, 607] != 255:
            raise ValueError("pillow tracking or prompt replay failed")
        path = out / f"mask-{i:04d}.png"
        Image.fromarray(mask).save(path)
        rows.append({"frame": i, "sourceSha256": digest(frames / f"{i:05d}.jpg"),
                     "maskSha256": digest(path), "rawArea": int((mask != 0).sum())})
    report = {"upstream": revision, "weightsSha256": digest(weights), "region": REGION,
              "points": POINTS, "frames": rows}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")


def decode(path, shape):
    raw = media("-i", str(path), "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
    return np.frombuffer(raw, np.uint8).reshape(shape)


def turquoise_fractions(frames, weights):
    fractions = []
    for rgb, alpha in zip(frames, weights, strict=True):
        red, green, blue = rgb[alpha != 0].astype(np.int16).T
        fractions.append(float(np.mean((green > red + 20) & (blue > red + 20))))
    return fractions


def generate(model, sample, out):
    revision = verify_model(model)
    manifest = sample / "report.json"
    input_hash = digest(manifest)
    spec = json.loads(manifest.read_bytes())
    if (tuple(spec["region"]) != REGION or len(spec["frames"]) != 9 or
            [r["frame"] for r in spec["frames"]] != list(range(9))):
        raise ValueError("unexpected experiment region or frame sequence")
    allowed = np.zeros((540, 960), dtype=bool)
    left, top, right, bottom = REGION
    allowed[top:bottom, left:right] = True
    controls, masks, weights, source = [], [], [], []
    for i, row in enumerate(spec["frames"]):
        src, label = sample / "frames" / f"{i:05d}.jpg", sample / f"mask-{i:04d}.png"
        if digest(src) != row["sourceSha256"] or digest(label) != row["maskSha256"]:
            raise ValueError("source frame or mask digest mismatch")
        with Image.open(src) as im, Image.open(label) as mask:
            rgb = np.array(im.convert("RGB"))
            video, binary, alpha = CANVAS.condition(rgb, np.array(mask), allowed)
        source.append(rgb)
        controls.append(video)
        masks.append(binary)
        weights.append(alpha)
    out.mkdir(parents=True, exist_ok=False)
    condition_hashes = save_conditions(out, controls, masks)
    frames, runtime = generate_shot(model, out, controls, masks, prompt=PROMPT, negative_prompt=NEGATIVE,
                                    steps=20, seed=SEED)
    encode_rgb(out / "candidate.mp4", np.stack([np.asarray(frame) for frame in frames]), "832x480")
    final = np.stack([composite_rgb24(src, CANVAS.restore(frame), allowed, alpha)
                      for src, frame, alpha in zip(source, frames, weights, strict=True)])
    protected = np.stack(weights) == 0
    source = np.stack(source)
    if not np.array_equal(final[protected], source[protected]):
        raise ValueError("protected pixel changed")
    encode_rgb(out / "noop.mp4", source, "960x540")
    encode_rgb(out / "composite.mp4", final, "960x540")
    for name in ("candidate", "noop", "composite"):
        check_pts(probe_frames(out / f"{name}.mp4"), 9)
    base = decode(out / "noop.mp4", source.shape)
    decoded = decode(out / "composite.mp4", source.shape)
    errors = np.abs(decoded[protected].astype(np.int16) - base[protected].astype(np.int16))
    sheet = Image.new("RGB", (960, 540))
    for j, i in enumerate((0, 4, 8)):
        for k, rgb in enumerate((source[i], CANVAS.restore(frames[i]), decoded[i])):
            sheet.paste(Image.fromarray(rgb).resize((320, 180), Image.Resampling.LANCZOS), (k * 320, j * 180))
    sheet.save(out / "review.png")
    for i, row in enumerate(spec["frames"]):
        if digest(sample / "frames" / f"{i:05d}.jpg") != row["sourceSha256"]:
            raise ValueError("source frame changed during generation")
    if digest(manifest) != input_hash:
        raise ValueError("input manifest changed")
    report = {"revision": revision, "sam2ReportSha256": input_hash, "conditions": condition_hashes,
              "sampleFps": 9, "seed": SEED, "steps": 20, "guidanceScale": 5.0, "prompt": PROMPT,
              "negativePrompt": NEGATIVE, "runtime": runtime, "protectedPixels": int(protected.sum()),
              "preencodeProtectedMaxError": 0, "encodedProtectedMeanErrorVsNoop": float(errors.mean()),
              "encodedProtectedMaxErrorVsNoop": int(errors.max()),
              "sourceTurquoiseByFrame": turquoise_fractions(base, weights),
              "exportTurquoiseByFrame": turquoise_fractions(decoded, weights),
              "candidateSha256": digest(out / "candidate.mp4"), "outputSha256": digest(out / "composite.mp4")}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    commands = cli.add_subparsers(dest="action", required=True)
    mask = commands.add_parser("prepare")
    mask.add_argument("--source", type=Path, required=True)
    mask.add_argument("--weights", type=Path, required=True)
    synth = commands.add_parser("generate")
    synth.add_argument("--model", type=Path, required=True)
    synth.add_argument("--sample", type=Path, required=True)
    for sub in (mask, synth):
        sub.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    if args.action == "prepare":
        prepare(args.source.resolve(), args.weights.resolve(), args.output.resolve())
    else:
        generate(args.model.resolve(), args.sample.resolve(), args.output.resolve())
