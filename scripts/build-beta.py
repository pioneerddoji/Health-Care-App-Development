#!/usr/bin/env python3
"""베타 대기자 페이지 빌드 — web/beta.html → docs/beta/index.html (+ media/)

기존 랜딩 빌드(`build-landing.py`)와 완전히 분리돼 있다. 이 스크립트는
`docs/index.html` 을 절대 건드리지 않는다.

왜 빌드 단계가 필요한가
  1) 동적 이미지는 `scripts/record-beta-clips.mjs` 가 **실제로 동작하는 웹
     빌드를 조작하며 녹화**한 것이다. 목업이 아니다. 소스에는 `data-anim`
     이름만 적어 두고, 여기서 실제 파일명·크기·포스터를 써 넣는다.
  2) `prefers-reduced-motion` 대응. 애니메이션 WebP 는 CSS 로 멈출 수 없으므로
     `<picture>` 의 media 질의로 **정지 포스터를 먼저 고르게** 한다. 손으로
     쓰면 세 곳에서 어긋나므로 빌드가 만든다.
  3) `width`/`height` 를 인코딩 결과에서 직접 읽어 넣는다. 손으로 관리하면
     클립을 다시 찍을 때마다 어긋나 로드 전 레이아웃이 튄다.

사용법
  python3 scripts/build-beta.py

클립을 다시 찍으려면
  (1) npx expo export --platform web --output-dir dist-web
  (2) cd dist-web && python3 -m http.server 8099
  (3) node scripts/record-beta-clips.mjs      # → web/beta-media/*.webp
  (4) python3 scripts/build-beta.py
"""
from __future__ import annotations

import pathlib
import re
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "beta.html"
MEDIA_SRC = ROOT / "web" / "beta-media"
OUT_DIR = ROOT / "docs" / "beta"
MEDIA_OUT = OUT_DIR / "media"

# GitHub Pages 공개 주소. Formspree `_next` 리다이렉트가 이 주소로 돌아온다.
PAGE_URL = "https://pioneerddoji.github.io/Health-Care-App-Development/beta/"

# data-anim 이름 → (애니메이션 파일, 정지 포스터)
CLIPS = {
    "record": ("record.webp", "record-poster.webp"),
    "chart": ("chart.webp", "chart-poster.webp"),
    "report": ("report.webp", "report-poster.webp"),
}

IMG_RE = re.compile(r'<img\s+data-anim="([a-z]+)"\s+alt="([^"]*)"\s*/?>')

# 배포 전 반드시 사람이 채워야 하는 값들. 남아 있으면 빌드가 크게 경고한다.
PLACEHOLDERS = ("__BETA_FORM_ID__", "__CONTACT_EMAIL__")


def rewrite(html: str) -> str:
    seen: set[str] = set()

    def sub(m: re.Match[str]) -> str:
        name, alt = m.group(1), m.group(2)
        if name not in CLIPS:
            sys.exit(f"알 수 없는 클립 이름: {name}")
        anim, poster = CLIPS[name]
        path = MEDIA_SRC / anim
        if not path.exists():
            sys.exit(f"클립 없음: {path} — 먼저 `node scripts/record-beta-clips.mjs` 실행")
        with Image.open(path) as im:
            w, h = im.size
        # 히어로(첫 등장)만 즉시 로드한다. 나머지는 스크롤해야 보인다.
        first = name not in seen
        seen.add(name)
        loading = 'loading="eager" fetchpriority="high"' if first else 'loading="lazy"'
        return (
            "<picture>"
            f'<source media="(prefers-reduced-motion: reduce)" srcset="media/{poster}">'
            f'<img src="media/{anim}" width="{w}" height="{h}" alt="{alt}" {loading}>'
            "</picture>"
        )

    out = IMG_RE.sub(sub, html)
    if 'data-anim=' in out:
        sys.exit("치환되지 않은 data-anim 이 남아 있다 — IMG_RE 패턴 확인")
    return out.replace("__PAGE_URL__", PAGE_URL)


def main() -> None:
    html = SRC.read_text(encoding="utf-8")
    body = rewrite(html)

    MEDIA_OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for anim, poster in CLIPS.values():
        for f in (anim, poster):
            src = MEDIA_SRC / f
            if not src.exists():
                sys.exit(f"에셋 없음: {src}")
            data = src.read_bytes()
            (MEDIA_OUT / f).write_bytes(data)
            total += len(data)

    og = MEDIA_SRC / "og.png"
    if og.exists():
        (OUT_DIR / "og.png").write_bytes(og.read_bytes())
        total += og.stat().st_size
    else:
        print("  ! og.png 없음 — `node scripts/make-beta-og.mjs` 로 만들 것")

    dest = OUT_DIR / "index.html"
    dest.write_text(body, encoding="utf-8")
    print(f"  {dest}  {len(body.encode()) // 1024}KB")
    print(f"  {MEDIA_OUT}  에셋 {total // 1024}KB")

    left = [p for p in PLACEHOLDERS if p in body]
    if left:
        print()
        print("  ⚠️  자리표시자가 남아 있다 — 공개 전 반드시 교체할 것:")
        for p in left:
            print(f"      {p}  ({body.count(p)}곳)")
        print("      web/beta.html 을 고친 뒤 이 스크립트를 다시 실행한다.")


if __name__ == "__main__":
    main()
