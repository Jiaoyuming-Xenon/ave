#!/usr/bin/env python3
"""Restore or verify the exact Pi and Paseo research revisions.

Reference checkouts are intentionally ignored by the M0 repository. The M1 Paseo
implementation requires a separate ADR and a team downstream fork managed by an
exact gitlink, never a silently modified nested working tree.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "research" / "upstream.json"


def git(*args: str, cwd: Path | None = None, timeout: int = 60) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd or ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout.strip()


def verify(reference: dict) -> str:
    checkout = ROOT / reference["path"]
    if not (checkout / ".git").exists():
        return f"{reference['path']}: 未克隆"
    actual = git("rev-parse", "HEAD", cwd=checkout)
    if actual != reference["commit"]:
        return f"{reference['path']}: HEAD {actual} != 锁定 {reference['commit']}"
    dirty = git("status", "--porcelain", cwd=checkout)
    if dirty:
        return f"{reference['path']}: 版本正确，但有未提交改动（未触碰）"
    return f"{reference['path']}: {actual[:12]} 已锁定且干净"


def restore(reference: dict) -> str:
    checkout = ROOT / reference["path"]
    if (checkout / ".git").exists():
        return verify(reference)
    if checkout.exists():
        raise RuntimeError(f"{checkout} 已存在且不是 Git 仓库；请先人工处理，脚本不会覆盖")
    git("clone", "--filter=blob:none", "--no-checkout", reference["url"], str(checkout), timeout=900)
    git("checkout", "--detach", reference["commit"], cwd=checkout, timeout=300)
    return verify(reference)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restore", action="store_true", help="clone missing reference checkouts")
    args = parser.parse_args()
    references = json.loads(CONFIG.read_text(encoding="utf-8"))["references"]
    failed = False
    for reference in references:
        try:
            message = restore(reference) if args.restore else verify(reference)
            print(message)
            failed |= any(marker in message for marker in ("未克隆", "!=", "有未提交改动"))
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            failed = True
            print(f"{reference['path']}: {error}", file=sys.stderr)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
