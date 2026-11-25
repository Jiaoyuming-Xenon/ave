"""G3 frame kernel acceptance; synthetic edit candidate, no model or daemon involved."""
from hashlib import sha256
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "vendor/paseo/plugins/video-editor/worker"))
from protected_composite import composite_rgb24


def ffmpeg(*args, data=None):
    return subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-xerror", *args], input=data,
                          stdout=subprocess.PIPE, check=True, timeout=30).stdout


def rgb(path):
    return ffmpeg("-i", path, "-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "rawvideo", "-")


def check(directory):
    source, output = directory / "source.mkv", directory / "composite.mkv"
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=32x24:rate=4:duration=1", "-c:v", "ffv1", "-pix_fmt", "bgr0", source)
    original_digest = sha256(source.read_bytes()).digest()
    frames = np.frombuffer(rgb(source), dtype=np.uint8).reshape(4, 24, 32, 3)
    results = []
    supports = []
    protected = 0
    for index, frame in enumerate(frames):
        candidate = 255 - frame  # Deliberately changes every pixel, even protected ones.
        region = np.zeros(frame.shape[:2], dtype=bool)
        region[6:16, index+4:index+16] = True
        alpha = np.zeros(frame.shape[:2], dtype=np.uint8)
        alpha[region] = 255
        alpha[6:16, index+4] = 128
        result = composite_rgb24(frame, candidate, region, alpha)
        protected += np.count_nonzero(~region)
        np.testing.assert_array_equal(result[~region], frame[~region])
        np.testing.assert_array_equal(result[alpha == 255], candidate[alpha == 255])
        edges = alpha == 128
        expected = np.rint((127 * frame[edges].astype(float) + 128 * candidate[edges].astype(float)) / 255)
        np.testing.assert_array_equal(result[edges], expected.astype(np.uint8))
        assert not np.shares_memory(frame, result)
        results.append(result)
        supports.append(region)
        expanded = alpha.copy()
        expanded[0, 0] = 1
        for bad_candidate, bad_alpha in [(candidate, expanded), (candidate[:, :-1], alpha)]:
            try:
                composite_rgb24(frame, bad_candidate, region, bad_alpha)
            except ValueError:
                continue
            raise AssertionError("accepted out-of-support alpha or mismatched frame")
    raw = np.stack(results).tobytes()
    ffmpeg("-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "32x24", "-r", "4", "-i", "pipe:0", "-c:v", "ffv1", "-pix_fmt", "bgr0", output, data=raw)
    assert rgb(output) == raw

    # Compare *decoded* edited pixels with an identically encoded source-only baseline.
    # This is a measurement, not a pass threshold for arbitrary footage or encoders.
    def h264_decode(name, data):
        target = directory / name
        ffmpeg("-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "32x24", "-r", "4", "-i", "pipe:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-threads", "1", target, data=data)
        return np.frombuffer(rgb(target), dtype=np.uint8).reshape(frames.shape).astype(np.int16)

    baseline = h264_decode("baseline.mp4", frames.tobytes())
    decoded = h264_decode("edited.mp4", raw)
    outside = ~np.stack(supports)
    delta = np.abs(decoded[outside] - baseline[outside])
    print(f"H.264 vs same-encoder baseline outside edit: mean abs RGB {delta.mean():.3f}/255, max {delta.max()}/255 ({protected} pixels); no quality threshold applied.")
    assert sha256(source.read_bytes()).digest() == original_digest
    print(f"PASS: 4 frames, {protected} protected pixels identical; opaque and feather checks passed; lossless RGB round trip; source unchanged.")


if __name__ == "__main__":
    with TemporaryDirectory(prefix="video-protected-g3-") as tmp:
        check(Path(tmp))
