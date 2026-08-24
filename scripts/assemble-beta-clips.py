#!/usr/bin/env python3
"""PNG 시퀀스 → 애니메이션 WebP + 정지 포스터.

`record-beta-clips.mjs` 가 호출한다. 직접 쓸 일은 거의 없다.

    python3 scripts/assemble-beta-clips.py <시퀀스루트> <출력폴더> <프레임간격ms>

품질 60을 쓴다. 45 로 내리면 30% 더 작아지지만 앱 화면의 작은 한글이
뭉개진다 — 이 소재는 "글씨가 읽히는 것"이 전부라 여기서 아끼지 않는다.
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image

QUALITY = 60


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    seq_root = pathlib.Path(sys.argv[1])
    out_dir = pathlib.Path(sys.argv[2])
    duration = int(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)

    total = 0
    for d in sorted(p for p in seq_root.iterdir() if p.is_dir()):
        files = sorted(d.glob("*.png"))
        if not files:
            sys.exit(f"프레임 없음: {d}")
        frames = [Image.open(f).convert("RGB") for f in files]

        anim = out_dir / f"{d.name}.webp"
        frames[0].save(anim, "WEBP", save_all=True, append_images=frames[1:],
                       duration=duration, loop=0, quality=QUALITY,
                       method=4, minimize_size=True)

        # 모션 최소화 요청 시 <picture> 가 대신 고르는 정지 이미지.
        # **마지막 프레임**을 쓴다 — 이 사람에게는 이 한 장이 전부이므로,
        # 시작 상태(빈 폼)보다 끝 상태(저장된 기록 / 그려진 그래프)가 훨씬
        # 많은 것을 말해 준다.
        poster = out_dir / f"{d.name}-poster.webp"
        frames[-1].save(poster, "WEBP", quality=82, method=6)

        size = anim.stat().st_size
        total += size + poster.stat().st_size
        secs = len(frames) * duration / 1000
        print(f"  {anim.name}  {size // 1024}KB / {len(frames)}프레임 / {secs:.1f}초")

    print(f"  합계 {total // 1024}KB")


if __name__ == "__main__":
    main()
