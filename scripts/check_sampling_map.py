"""Verify sampling against decoded VFR frame times and lossless CFR working bytes; no model."""
from fractions import Fraction
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "vendor/paseo/plugins/video-editor/worker"))
from sampling_map import FrameSpan, sample_shot, sample_index_shot


def run(*args, data=None):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, check=True, timeout=30).stdout


def probe(path):
    raw = run("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_streams", "-show_entries", "stream=time_base:frame=pts,duration", "-of", "json", path)
    doc = json.loads(raw)
    return (tuple(FrameSpan(int(f["pts"]), int(f["duration"])) for f in doc["frames"]),
            Fraction(doc["streams"][0]["time_base"]), sha256(raw).hexdigest())


def rejected(message, fn):
    try:
        fn()
    except ValueError as e:
        assert message in str(e), e
    else:
        raise AssertionError(f"expected rejection: {message}")


def check(root):
    vfr = root / "source.mp4"
    run("ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=80x48:rate=25:duration=0.36", "-vf", "select='not(eq(n,2))'", "-fps_mode", "vfr", "-c:v", "libx264", "-bf", "0", "-output_ts_offset", "2", vfr)
    source_hash = sha256(vfr.read_bytes()).digest()
    spans, clock, _ = probe(vfr)
    assert spans[0].pts * clock == 2 and len(spans) == 8
    # Wire-shaped fixture built from the actual probe, not a daemon import.
    index = json.dumps({"schemaVersion":"video.presentation-index/v2", "sourceSha256":source_hash.hex(),
        "streams":[{"streamIndex":0, "streamUid":"stream:0", "timeBase":{"num":str(clock.numerator),"den":str(clock.denominator)}}],
        "frames":[{"stream_index":0,"media_type":"video","pts":str(f.pts),"duration":str(f.duration)} for f in spans]}).encode()
    index_hash = sha256(index).hexdigest()
    args = dict(index_sha256=index_hash, source_sha256=source_hash.hex(), stream_uid="stream:0", first=0, stop=len(spans), rate=Fraction(25))
    sample = sample_index_shot(index, **args)
    rejected("index digest mismatch", lambda: sample_index_shot(index + b" ", **args))
    rejected("source digest", lambda: sample_index_shot(index, **(args | {"source_sha256":"0"*64})))
    rejected("source stream", lambda: sample_index_shot(index, **(args | {"stream_uid":"stream:1"})))
    assert sample_index_shot(index, **(args | {"first":2})).source_frames == spans[2:]
    expected = (0, 1, 1, 2, 3, 4, 5, 6, 7)
    assert sample.sample_to_source == expected and sample.source_to_samples()[1] == (1, 2)
    def decode(path):
        return run("ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", path, "-map", "0:v:0", "-fps_mode", "passthrough", "-pix_fmt", "rgb24", "-f", "rawvideo", "-")
    source = decode(vfr)
    size = 80 * 48 * 3
    assert len(source) == size * 8
    work = root / "working.mkv"
    sampled = b"".join(source[i*size:(i+1)*size] for i in sample.sample_to_source)
    run("ffmpeg", "-nostdin", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "80x48", "-r", "25", "-i", "pipe:0", "-c:v", "ffv1", "-pix_fmt", "bgr0", work, data=sampled)
    actual, working_clock, _ = probe(work)
    sample.validate_output(actual, working_clock)
    assert decode(work) == sampled
    rejected("explicit time mapping", lambda: sample.rebind_unchanged(actual, working_clock))
    rejected("frame count", lambda: sample.validate_output(actual[:-1], working_clock))
    shifted = (FrameSpan(actual[0].pts+1, actual[0].duration), *actual[1:])
    rejected("PTS or duration", lambda: sample.validate_output(shifted, working_clock))
    short = (*actual[:-1], FrameSpan(actual[-1].pts, actual[-1].duration-1))
    rejected("PTS or duration", lambda: sample.validate_output(short, working_clock))
    rejected("overlap or leave a gap", lambda: sample_shot(spans[:1] + spans[2:], clock, Fraction(25), index_hash))
    # Preserve adjacent ticks beyond JS's safe integer range, without floats or a zero-origin assumption.
    shift = 2**53 + 1
    high = tuple(FrameSpan(shift+i, 1) for i in range(9))
    identity = sample_shot(high, Fraction(1,25), Fraction(25), index_hash)
    assert identity.rebind_unchanged(actual, working_clock) == high
    assert sha256(vfr.read_bytes()).digest() == source_hash
    print("PASS: source 8 VFR frames at 2 s -> 9 verified 25 Hz samples (source #1 twice); exact pixels and timestamps; invalid rebind, count, clock position, duration and gap rejected; large ticks retained.")


if __name__ == "__main__":
    with TemporaryDirectory(prefix="video-sampling-qa-") as tmp:
        check(Path(tmp))
