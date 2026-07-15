// 차트 SVG 문자열 생성 — 앱(SvgXml)과 PDF(inline SVG)가 공유하는 단일 코드 경로.
// 팔레트: dataviz 검증기 통과값 (라이트 서피스 #fcfcfb 기준)

export const PALETTE = {
  series: ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'],
  critical: '#d03b3b',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  muted: '#898781',
  ink: '#52514e',
  surface: '#fcfcfb',
};

const FONT = 'font-family="system-ui, -apple-system, sans-serif"';

export interface Point { label: string; value: number | null }
export interface Bar { label: string; value: number; annotation?: string }

interface Frame {
  w: number; h: number;
  padL: number; padR: number; padT: number; padB: number;
  yMin: number; yMax: number;
}

const yPos = (f: Frame, v: number) =>
  f.padT + (f.h - f.padT - f.padB) * (1 - (v - f.yMin) / (f.yMax - f.yMin || 1));

const niceTicks = (min: number, max: number, count = 3): number[] => {
  const span = max - min || 1;
  const step = span / (count + 1);
  // 값이 크면 정수 눈금으로 — 라벨 폭이 좌측 여백을 넘지 않게
  const round = (v: number) => (span >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
  return Array.from({ length: count }, (_, i) => round(min + step * (i + 1)));
};

const gridAndAxis = (f: Frame, unit: string): string => {
  const ticks = niceTicks(f.yMin, f.yMax);
  const lines = ticks.map((t) => {
    const y = yPos(f, t);
    return `<line x1="${f.padL}" y1="${y}" x2="${f.w - f.padR}" y2="${y}" stroke="${PALETTE.grid}" stroke-width="1"/>` +
      `<text x="${f.padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${PALETTE.muted}" ${FONT}>${t}${unit}</text>`;
  }).join('');
  const baseY = yPos(f, f.yMin);
  return lines +
    `<line x1="${f.padL}" y1="${baseY}" x2="${f.w - f.padR}" y2="${baseY}" stroke="${PALETTE.baseline}" stroke-width="1"/>`;
};

// x축 라벨 — 많으면 솎아서 표시
const xLabels = (f: Frame, labels: string[], xOf: (i: number) => number): string => {
  const every = Math.max(1, Math.ceil(labels.length / 7));
  return labels.map((l, i) =>
    i % every === 0
      ? `<text x="${xOf(i)}" y="${f.h - 4}" text-anchor="middle" font-size="9" fill="${PALETTE.muted}" ${FONT}>${l}</text>`
      : '',
  ).join('');
};

export interface LineChartOpts {
  points: Point[];
  unit?: string;
  color?: string;
  yMin?: number;
  yMax?: number;
  refLine?: { value: number; label: string };
  width?: number;
  height?: number;
}

/** 라인 차트 (체온, 성장) — 2px 라인 + 8px 마커, 기준선 옵션 */
export const lineChartSvg = (o: LineChartOpts): string => {
  const w = o.width ?? 340, h = o.height ?? 150;
  const vals = o.points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return emptyChartSvg(w, h);
  const rawMin = Math.min(...vals, o.refLine?.value ?? Infinity);
  const rawMax = Math.max(...vals, o.refLine?.value ?? -Infinity);
  const pad = Math.max((rawMax - rawMin) * 0.15, 0.3);
  const f: Frame = {
    w, h, padL: 44, padR: 10, padT: 10, padB: 18,
    yMin: o.yMin ?? Math.floor((rawMin - pad) * 10) / 10,
    yMax: o.yMax ?? Math.ceil((rawMax + pad) * 10) / 10,
  };
  const n = o.points.length;
  const xOf = (i: number) => f.padL + (w - f.padL - f.padR) * (n === 1 ? 0.5 : i / (n - 1));
  const color = o.color ?? PALETTE.series[0];

  let path = '', started = false;
  o.points.forEach((p, i) => {
    if (p.value === null) { started = false; return; }
    path += `${started ? 'L' : 'M'}${xOf(i).toFixed(1)},${yPos(f, p.value).toFixed(1)} `;
    started = true;
  });
  const markers = o.points.map((p, i) => p.value === null ? '' :
    `<circle cx="${xOf(i).toFixed(1)}" cy="${yPos(f, p.value).toFixed(1)}" r="3.5" fill="${color}" stroke="${PALETTE.surface}" stroke-width="2"/>`,
  ).join('');
  const ref = o.refLine
    ? `<line x1="${f.padL}" y1="${yPos(f, o.refLine.value)}" x2="${w - f.padR}" y2="${yPos(f, o.refLine.value)}" stroke="${PALETTE.critical}" stroke-width="1" stroke-dasharray="4 3"/>` +
      `<text x="${w - f.padR}" y="${yPos(f, o.refLine.value) - 4}" text-anchor="end" font-size="9" fill="${PALETTE.critical}" ${FONT}>${o.refLine.label}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    gridAndAxis(f, o.unit ?? '') + ref +
    `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    markers + xLabels(f, o.points.map((p) => p.label), xOf) + '</svg>';
};

export interface BarChartOpts {
  bars: Bar[];
  unit?: string;
  color?: string;
  width?: number;
  height?: number;
}

/** 바 차트 (수면시간, 식사 점수, 수분) — 상단 2px 라운드, 막대 간 2px 갭 */
export const barChartSvg = (o: BarChartOpts): string => {
  const w = o.width ?? 340, h = o.height ?? 150;
  if (o.bars.length === 0) return emptyChartSvg(w, h);
  const max = Math.max(...o.bars.map((b) => b.value), 1);
  const f: Frame = { w, h, padL: 44, padR: 10, padT: 10, padB: 18, yMin: 0, yMax: max * 1.15 };
  const n = o.bars.length;
  const slot = (w - f.padL - f.padR) / n;
  const bw = Math.min(Math.max(slot - 2, 3), 22);
  const color = o.color ?? PALETTE.series[0];
  const baseY = yPos(f, 0);

  const bars = o.bars.map((b, i) => {
    const x = f.padL + slot * i + (slot - bw) / 2;
    const y = yPos(f, b.value);
    const bh = Math.max(baseY - y, b.value > 0 ? 2 : 0);
    if (bh === 0) return '';
    return `<path d="M${x},${baseY} V${y + 2} Q${x},${y} ${x + 2},${y} H${x + bw - 2} Q${x + bw},${y} ${x + bw},${y + 2} V${baseY} Z" fill="${color}"/>` +
      (b.annotation
        ? `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" font-size="8" fill="${PALETTE.ink}" ${FONT}>${b.annotation}</text>`
        : '');
  }).join('');

  const xOf = (i: number) => f.padL + slot * i + slot / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    gridAndAxis(f, o.unit ?? '') + bars +
    xLabels(f, o.bars.map((b) => b.label), xOf) + '</svg>';
};

export interface GroupedBarOpts {
  labels: string[];
  series: { name: string; color: string; values: number[] }[];
  width?: number;
  height?: number;
}

/** 그룹 바 차트 (배변: 대변/소변) — 시리즈 2개 + 범례 + 직접 라벨 */
export const groupedBarSvg = (o: GroupedBarOpts): string => {
  const w = o.width ?? 340, h = o.height ?? 160;
  const max = Math.max(...o.series.flatMap((s) => s.values), 1);
  const f: Frame = { w, h, padL: 44, padR: 10, padT: 24, padB: 18, yMin: 0, yMax: max * 1.15 };
  const n = o.labels.length;
  const slot = (w - f.padL - f.padR) / n;
  const bw = Math.min(Math.max((slot - 2) / o.series.length - 2, 2), 12);
  const baseY = yPos(f, 0);

  const bars = o.series.map((s, si) =>
    s.values.map((v, i) => {
      if (v <= 0) return '';
      const groupW = bw * o.series.length + 2 * (o.series.length - 1);
      const x = f.padL + slot * i + (slot - groupW) / 2 + si * (bw + 2);
      const y = yPos(f, v);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(baseY - y, 2).toFixed(1)}" rx="2" fill="${s.color}"/>`;
    }).join(''),
  ).join('');

  const legend = o.series.map((s, si) =>
    `<circle cx="${f.padL + 8 + si * 70}" cy="12" r="4" fill="${s.color}"/>` +
    `<text x="${f.padL + 16 + si * 70}" y="15" font-size="9" fill="${PALETTE.ink}" ${FONT}>${s.name}</text>`,
  ).join('');

  const xOf = (i: number) => f.padL + slot * i + slot / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    gridAndAxis(f, '') + legend + bars + xLabels(f, o.labels, xOf) + '</svg>';
};

export interface TimelineOpts {
  dates: string[];                        // x축 (짧은 날짜 라벨)
  rows: { symptom: string; cells: (number | null)[] }[]; // severity 1~5 or null
  width?: number;
}

/** 증상 타임라인 — 날짜×증상 도트, 심각도는 크기(+라벨)로 인코딩 */
export const timelineSvg = (o: TimelineOpts): string => {
  const w = o.width ?? 340;
  const rowH = 24, padL = 78, padR = 10, padT = 8, padB = 18;
  const h = padT + padB + rowH * Math.max(o.rows.length, 1);
  if (o.rows.length === 0) return emptyChartSvg(w, h);
  const n = o.dates.length;
  const xOf = (i: number) => padL + (w - padL - padR) * (n === 1 ? 0.5 : i / (n - 1));

  const rows = o.rows.map((row, ri) => {
    const y = padT + rowH * ri + rowH / 2;
    const color = PALETTE.series[ri % PALETTE.series.length];
    const label = `<text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9" fill="${PALETTE.ink}" ${FONT}>${row.symptom}</text>`;
    const track = `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${PALETTE.grid}" stroke-width="1"/>`;
    const dots = row.cells.map((sev, i) => sev === null ? '' :
      `<circle cx="${xOf(i).toFixed(1)}" cy="${y}" r="${3 + sev}" fill="${color}" stroke="${PALETTE.surface}" stroke-width="2"/>`,
    ).join('');
    return track + label + dots;
  }).join('');

  const every = Math.max(1, Math.ceil(n / 7));
  const axis = o.dates.map((d, i) => i % every === 0
    ? `<text x="${xOf(i)}" y="${h - 4}" text-anchor="middle" font-size="9" fill="${PALETTE.muted}" ${FONT}>${d}</text>`
    : '').join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${rows}${axis}</svg>`;
};

export const emptyChartSvg = (w = 340, h = 150): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
  `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="11" fill="${PALETTE.muted}" ${FONT}>기간 내 기록이 없습니다</text></svg>`;
