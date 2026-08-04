#!/usr/bin/env python3
"""랜딩 페이지 빌드 — web/landing.html → docs/index.html (+ docs/shots/*.webp)

왜 빌드 단계가 필요한가
  1) 데모 이미지는 `scripts/screenshot-all.mjs`가 뽑은 **실제 앱 화면**이다.
     원본은 780×1688(2배율) PNG로 한 장에 100KB가 넘어 그대로 못 쓴다.
     여기서 자르고 줄여서 WebP로 굽는다.
  2) `docs/index.html`은 GitHub Pages용이라 `<!doctype html>`이 반드시 있어야
     한다. 없으면 quirks 모드로 떨어져 표가 색을 상속하지 못한다(실제로 겪음).
  3) Artifact(claude.ai) 배포본은 CSP가 외부 이미지를 막으므로 base64로
     인라인해야 한다. 같은 소스에서 두 형태를 만든다.

사용법
  python3 scripts/build-landing.py            # docs/ 갱신
  python3 scripts/build-landing.py --inline OUT.html   # Artifact용 인라인본

앱 화면이 바뀌면: `node scripts/screenshot-all.mjs` 다시 돌린 뒤 이 스크립트만
재실행하면 랜딩의 데모 이미지가 함께 갱신된다.
"""
from __future__ import annotations

import argparse
import base64
import io
import pathlib
import re
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "web" / "landing.html"
SHOT_SRC = ROOT / "scripts" / "output"
DOCS = ROOT / "docs"

QUALITY = 75

# data-shot 이름 → (원본 파일, 자를 영역(2배율 좌표) 또는 None, 목표 가로폭)
SHOTS: dict[str, tuple[str, tuple[int, int, int, int] | None, int]] = {
    "form":   ("09-record-form.png",     None,                  390),
    # 위쪽(증상·체온·심한 정도)은 form과 겹친다. 사진 첨부부터만 남긴다.
    "photo":  ("10-photo-and-tags.png",  (0, 1010, 780, 1560),  560),
    "day":    ("08-day-records.png",     None,                  390),
    "chart":  ("11-dashboard.png",       None,                  390),
    "report": ("14-report.png",          None,                  390),
    # 공유 링크는 발급 결과만 보여 준다. 위쪽은 레포트 화면과 겹치고,
    # 캡처 당시 테스트 문구("사이클3 …")가 남아 있어 잘라 낸다.
    "link":   ("c3-report-link.png",     (0, 940, 780, 1610),   560),
    # 24·26은 1배율(390px) 캡처다. 확대하면 뭉개지므로 원본 폭을 유지하고,
    # 대신 빈 여백을 잘라 카드 안에서 높이가 튀지 않게 한다.
    "home":   ("24-home-recipients.png", (0, 0, 390, 420),      390),
    "adult":  ("26-form-adult-type.png", (0, 0, 390, 495),      390),
}

IMG_RE = re.compile(r'<img\b[^>]*\bdata-shot="([a-z]+)"[^>]*>')
ATTR_RE = re.compile(r'\s+(src|width|height)="[^"]*"')

_sizes: dict[str, tuple[int, int]] = {}


def encode(name: str) -> bytes:
    src_file, box, width = SHOTS[name]
    path = SHOT_SRC / src_file
    if not path.exists():
        sys.exit(f"스크린샷 없음: {path} — 먼저 `node scripts/screenshot-all.mjs` 실행")
    im = Image.open(path).convert("RGB")
    if box:
        im = im.crop(box)
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    _sizes[name] = im.size
    buf = io.BytesIO()
    im.save(buf, "WEBP", quality=QUALITY, method=6)
    return buf.getvalue()


def rewrite(html: str, resolver) -> str:
    """src 와 width/height 를 실제 산출물 기준으로 다시 쓴다.

    크기를 손으로 관리하면 자르기 영역을 바꿀 때마다 어긋나고, 그러면 이미지가
    로드되기 전 레이아웃이 튄다. 인코딩 결과에서 그대로 가져온다."""
    seen: set[str] = set()

    def sub(m: re.Match[str]) -> str:
        tag, name = m.group(0), m.group(1)
        if name not in SHOTS:
            sys.exit(f'data-shot="{name}" 에 대응하는 원본이 SHOTS에 없다')
        seen.add(name)
        src = resolver(name)              # 여기서 encode()가 돌아 _sizes 가 채워진다
        w, h = _sizes[name]
        tag = ATTR_RE.sub("", tag)
        return tag[:-1].rstrip() + f' src="{src}" width="{w}" height="{h}">'

    out = IMG_RE.sub(sub, html)
    unused = set(SHOTS) - seen
    if unused:
        print(f"  경고: HTML에서 안 쓰이는 shot — {', '.join(sorted(unused))}")
    return out


def build_docs(html: str) -> None:
    shots_dir = DOCS / "shots"
    shots_dir.mkdir(parents=True, exist_ok=True)
    total = 0
    for name in SHOTS:
        data = encode(name)
        (shots_dir / f"{name}.webp").write_bytes(data)
        total += len(data)
        print(f"  shots/{name}.webp  {len(data) // 1024}KB")
    print(f"  이미지 합계 {total // 1024}KB")

    body = rewrite(html, lambda n: f"shots/{n}.webp")

    m = re.search(r"<title>(.*?)</title>\n?", body, flags=re.S)
    title = m.group(1) if m else "케어노트"
    if m:
        body = body.replace(m.group(0), "")

    doc = f"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="케어노트 — 아이와 성인 가족의 건강 기록을 정리해 병원 제출용 레포트로 만들어 주는 앱.">
<meta property="og:title" content="{title}">
<meta property="og:description" content="체온·수면·식사·증상을 남겨두면 기간별 그래프와 병원 제출용 PDF 레포트로 정리해 드립니다.">
<meta property="og:type" content="website">
<meta name="color-scheme" content="dark">
</head>
<body>
{body.strip()}
</body>
</html>
"""
    out = DOCS / "index.html"
    out.write_text(doc, encoding="utf-8")
    print(f"  {out.relative_to(ROOT)}  {len(doc.encode()) // 1024}KB")


def build_inline(html: str, dest: pathlib.Path) -> None:
    cache: dict[str, str] = {}

    def uri(name: str) -> str:
        if name not in cache:
            b64 = base64.b64encode(encode(name)).decode("ascii")
            cache[name] = f"data:image/webp;base64,{b64}"
        return cache[name]

    body = rewrite(html, uri)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(body, encoding="utf-8")
    print(f"  {dest}  {len(body.encode()) // 1024}KB (이미지 인라인)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inline", metavar="OUT.html",
                    help="Artifact 배포용: 이미지를 base64로 인라인한 사본을 쓴다")
    args = ap.parse_args()

    html = SRC.read_text(encoding="utf-8")
    if args.inline:
        build_inline(html, pathlib.Path(args.inline))
    else:
        build_docs(html)


if __name__ == "__main__":
    main()
