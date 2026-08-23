// 병원 제출용 레포트 HTML 생성 — 순수 함수 (expo 의존성 없음, 단독 테스트 가능)
// 구성: 1p 요약 → 그래프(체온/수면/식사/배변) → 증상 타임라인 → 상세 기록
//       → 복용약 → 알레르기/기저질환 → 사진 → 보호자 질문 → 고정 디스클레이머
import type { ReportInput, DailyRecord } from '../types';
import { categoryLabel } from '../constants/categories';
import { recordTypeDef } from '../constants/recordTypes';
import { formatKorean, formatShort, dateRange, koreanAge, weekday } from '../lib/date';
import {
  inPeriod, aggregateTemperature, aggregateSleep, aggregateMeals,
  aggregateExcretion, symptomTimeline, summarizePeriod,
} from './records';
import { lineChartSvg, barChartSvg, groupedBarSvg, timelineSvg, PALETTE } from '../components/charts/svg';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const describePayload = (r: DailyRecord): string => {
  const p = r.payload;
  switch (r.type) {
    case 'condition': return `컨디션 ${p.level ?? '-'}/5${p.mood ? ` · ${p.mood}` : ''}`;
    case 'meal': return `${p.mealType ?? '식사'} ${p.amount ?? ''}${p.items?.length ? ` · ${p.items.join(', ')}` : ''}${p.waterMl ? ` · 수분 ${p.waterMl}ml` : ''}`;
    case 'sleep': return `${p.sleepStart ?? '?'}~${p.sleepEnd ?? '?'}${p.nightWakings != null ? ` · 밤중 깸 ${p.nightWakings}회` : ''}`;
    case 'excretion': return `${p.kind ?? ''} ${p.count ?? 1}회${p.stoolForm ? ` · ${p.stoolForm}` : ''}`;
    case 'activity': return `${p.activity ?? ''} ${p.durationMin ?? 0}분 (${p.intensity ?? '보통'})`;
    case 'symptom': return `${p.symptom ?? ''}${p.temperatureC ? ` ${p.temperatureC}℃` : ''}${p.severity ? ` · 심함 정도 ${p.severity}/5` : ''}`;
    case 'medication_dose': return `${p.medicationName ?? ''} ${p.givenAt ?? ''}${p.doseText ? ` · ${p.doseText}` : ''}`;
    case 'incident': return `${p.what ?? ''} (${p.incidentSeverity ?? ''})${p.action ? ` · 조치: ${p.action}` : ''}`;
    case 'media_use': return `${p.durationMin ?? 0}분${p.content ? ` · ${p.content}` : ''}`;
    case 'school': return p.attended === false ? `결석${p.note ? ` · ${p.note}` : ''}` : `등원/등교${p.note ? ` · ${p.note}` : ''}`;
    default: return p.note ?? '';
  }
};

export const buildReportHtml = (input: ReportInput): string => {
  const { child, periodStart, periodEnd, questionsForDoctor, briefingNote } = input;
  const records = inPeriod(input.records, periodStart, periodEnd)
    .sort((a, b) => (a.recordDate + (a.recordTime ?? '')).localeCompare(b.recordDate + (b.recordTime ?? '')));
  const summary = summarizePeriod(records, periodStart, periodEnd);
  const days = dateRange(periodStart, periodEnd);
  const shortDays = days.map(formatShort);

  // ── 그래프 (앱과 동일한 svg.ts 사용) ──
  // 논리 폭 340으로 생성한 뒤 CSS(width:100%)로 페이지 폭까지 확대 렌더 →
  // 차트 안 글자도 본문과 같은 배율(약 2배)로 커진다. viewBox 기반이라 벡터 무손실.
  const W = 340;
  const temps = aggregateTemperature(records);
  const tempSvg = lineChartSvg({
    width: W, height: 170, unit: '℃',
    points: temps.map((t) => ({ label: `${formatShort(t.date)} ${t.time ?? ''}`.trim(), value: t.value })),
    refLine: { value: 37.5, label: '37.5℃' },
  });
  const sleepSvg = barChartSvg({
    width: W, height: 150, unit: 'h',
    bars: aggregateSleep(records, periodStart, periodEnd).map((s) => ({
      label: formatShort(s.date), value: s.totalHours,
      annotation: s.wakings > 0 ? `깸${s.wakings}` : undefined,
    })),
  });
  const meals = aggregateMeals(records, periodStart, periodEnd);
  const mealSvg = barChartSvg({
    width: W, height: 140,
    bars: meals.map((m) => ({ label: formatShort(m.date), value: m.mealScore })),
    color: PALETTE.series[1],
  });
  const waterSvg = barChartSvg({
    width: W, height: 140, unit: 'ml',
    bars: meals.map((m) => ({ label: formatShort(m.date), value: m.waterMl })),
  });
  const excretion = aggregateExcretion(records, periodStart, periodEnd);
  const excretionSvg = groupedBarSvg({
    width: W, height: 160, labels: shortDays,
    series: [
      { name: '대변', color: PALETTE.series[0], values: excretion.map((e) => e.stool) },
      { name: '소변', color: PALETTE.series[1], values: excretion.map((e) => e.urine) },
    ],
  });
  const events = symptomTimeline(records);
  const symptomNames = [...new Set(events.map((e) => e.symptom))];
  const timeline = timelineSvg({
    width: W,
    dates: shortDays,
    rows: symptomNames.map((symptom) => ({
      symptom,
      cells: days.map((d) => {
        const hits = events.filter((e) => e.date === d && e.symptom === symptom);
        return hits.length ? Math.max(...hits.map((h) => h.severity)) : null;
      }),
    })),
  });

  // ── 상세 기록 (일자별 그룹) ──
  const detailRows = days.map((d) => {
    const dayRecords = records.filter((r) => r.recordDate === d);
    if (dayRecords.length === 0) return '';
    const rows = dayRecords.map((r) => {
      const def = recordTypeDef(r.type);
      const cats = r.categories.map(categoryLabel).join(', ');
      return `<tr>
        <td class="time">${r.recordTime ?? ''}</td>
        <td class="type">${def.emoji} ${def.label}</td>
        <td>${esc(describePayload(r))}${r.memo ? `<div class="memo">메모: ${esc(r.memo)}</div>` : ''}</td>
        <td class="cats">${esc(cats)}</td>
      </tr>`;
    }).join('');
    return `<h4>${formatKorean(d)} (${weekday(d)})</h4>
      <table><thead><tr><th>시간</th><th>유형</th><th>내용</th><th>영역</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('');

  // ── 사진 ──
  const photos = records.flatMap((r) =>
    r.photoUris.map((uri) => ({ uri, date: r.recordDate, type: recordTypeDef(r.type).label })));
  const photoSection = photos.length
    ? `<div class="photos">${photos.map((p) =>
        `<figure><img src="${p.uri}" /><figcaption>${formatShort(p.date)} · ${p.type}</figcaption></figure>`,
      ).join('')}</div>`
    : '<p class="empty">첨부된 사진이 없습니다.</p>';

  const meds = input.medications.filter((m) => m.childId === child.id);
  const vaccs = input.vaccinations.filter((v) => v.childId === child.id && v.doneDate);

  return `
<style>
  /* 폰트는 기존의 2배 — 진료실에서 바로 읽히는 크기 (사용자 피드백 반영) */
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
         color: #0b0b0b; font-size: 24px; line-height: 1.55; margin: 30px; }
  h1 { font-size: 40px; margin: 0 0 4px; }
  h2 { font-size: 28px; margin: 30px 0 12px; padding-bottom: 6px; border-bottom: 3px solid #2a78d6; }
  h4 { font-size: 24px; margin: 20px 0 6px; color: #52514e; }
  .sub { color: #898781; font-size: 22px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; font-size: 22px; }
  th { text-align: left; color: #898781; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid #c3c2b7; }
  td { padding: 6px 8px; border-bottom: 1px solid #e1e0d9; vertical-align: top; }
  td.time { width: 88px; color: #898781; } td.type { width: 170px; white-space: nowrap; }
  td.cats { width: 220px; color: #52514e; }
  .memo { color: #52514e; font-size: 20px; }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; }
  .stat { flex: 1 1 30%; background: #f9f9f7; border: 1px solid rgba(11,11,11,0.10);
          border-radius: 12px; padding: 14px 16px; }
  .stat b { display: block; font-size: 32px; }
  .stat span { color: #898781; font-size: 20px; }
  .tags span { display: inline-block; background: #e7f0fb; color: #1c5cab; border-radius: 999px;
               padding: 4px 16px; margin: 0 8px 8px 0; font-size: 22px; }
  .warn span { background: #fbeaea; color: #d03b3b; }
  .photos { display: flex; flex-wrap: wrap; gap: 10px; }
  figure { margin: 0; width: 260px; }
  figure img { width: 100%; border-radius: 10px; }
  figcaption { font-size: 20px; color: #898781; }
  .empty { color: #898781; }
  ol.q li { margin-bottom: 10px; }
  .disclaimer { margin-top: 30px; padding: 14px 16px; background: #f9f9f7; border-radius: 12px;
                color: #52514e; font-size: 20px; }
  .chart { margin: 8px 0 4px; }
  /* 차트를 페이지 폭까지 확대(viewBox 벡터 스케일) → 차트 글자도 본문과 같은 배율 */
  .chart svg { width: 100%; height: auto; }
  .page-break { page-break-before: always; }
</style>

<h1>건강 기록 레포트</h1>
<div class="sub">
  ${esc(child.name)} (${child.sex === 'female' ? '여' : '남'}, ${koreanAge(child.birthDate)},
  생년월일 ${formatKorean(child.birthDate)})
  · 기간 ${formatKorean(periodStart)} ~ ${formatKorean(periodEnd)}
  · 작성 보호자 ${esc(input.guardianName)}
  ${child.primaryHospital ? ` · 주치의 ${esc(child.primaryHospital)}${child.primaryDoctor ? ` ${esc(child.primaryDoctor)}` : ''}` : ''}
</div>

<h2>1. 기간 요약</h2>
<div class="summary">
  <div class="stat"><b>${summary.totalRecords}건</b><span>총 기록 수</span></div>
  <div class="stat"><b>${summary.feverDayCount}일</b><span>37.5℃ 이상 발열 기록일</span></div>
  <div class="stat"><b>${summary.maxTemp != null ? `${summary.maxTemp}℃` : '기록 없음'}</b><span>최고 체온</span></div>
  <div class="stat"><b>${summary.avgSleepHours != null ? `${summary.avgSleepHours}시간` : '기록 없음'}</b><span>평균 수면</span></div>
  <div class="stat"><b>${summary.medicationDoseCount}회</b><span>약 복용 기록</span></div>
  <div class="stat"><b>${summary.incidents.length}건</b><span>사고/안전 기록</span></div>
</div>
${summary.symptomNames.length ? `<p>기간 중 관찰된 증상: <b>${summary.symptomNames.map(esc).join(', ')}</b></p>` : ''}

<h2>2. 알레르기 · 기저질환</h2>
<div class="tags warn">${child.allergies.length ? child.allergies.map((a) => `<span>⚠ ${esc(a)}</span>`).join('') : '<span class="empty">등록된 알레르기 없음</span>'}</div>
<div class="tags">${child.chronicConditions.length ? child.chronicConditions.map((c) => `<span>${esc(c)}</span>`).join('') : '<span class="empty">등록된 기저질환 없음</span>'}</div>
${child.isPreterm ? `<p>조산아 (재태 ${child.gestationalWeeks ?? '?'}주)</p>` : ''}

<h2>3. 복용약</h2>
${meds.length ? `<table><thead><tr><th>약 이름</th><th>용법(기록된 그대로)</th><th>기간</th><th>처방</th></tr></thead><tbody>
${meds.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc([m.doseText, m.scheduleText].filter(Boolean).join(' · '))}</td>
<td>${m.startDate ? formatShort(m.startDate) : ''}~${m.endDate ? formatShort(m.endDate) : m.isActive ? '복용 중' : ''}</td>
<td>${esc(m.prescriber ?? '')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">등록된 복용약이 없습니다.</p>'}

<h2>4. 체온 그래프</h2><div class="chart">${tempSvg}</div>
<h2>5. 수면 그래프 (일별 총 수면시간 · 밤중 깸 횟수)</h2><div class="chart">${sleepSvg}</div>
<h2>6. 식사(섭취량 점수) · 수분 그래프</h2>
<div class="chart">${mealSvg}</div><div class="chart">${waterSvg}</div>
<h2>7. 배변 그래프</h2><div class="chart">${excretionSvg}</div>
<h2>8. 증상 타임라인 (점 크기 = 심한 정도)</h2><div class="chart">${timeline}</div>

<div class="page-break"></div>
<h2>9. 기간별 상세 기록</h2>
${detailRows || '<p class="empty">기간 내 기록이 없습니다.</p>'}

<h2>10. 사진</h2>
${photoSection}

<h2>11. 예방접종 (완료)</h2>
${vaccs.length ? `<table><thead><tr><th>백신</th><th>차수</th><th>접종일</th><th>병원</th><th>이상반응</th></tr></thead><tbody>
${vaccs.map((v) => `<tr><td>${esc(v.vaccineName)}</td><td>${v.doseNo}차</td><td>${v.doneDate ? formatKorean(v.doneDate) : ''}</td>
<td>${esc(v.hospital ?? '')}</td><td>${esc(v.adverseReaction ?? '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">기간과 무관하게 완료된 접종 기록이 없습니다.</p>'}

<h2>12. 보호자가 의사 선생님께 묻고 싶은 질문</h2>
${questionsForDoctor.length
    ? `<ol class="q">${questionsForDoctor.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>`
    : '<p class="empty">작성된 질문이 없습니다.</p>'}

<h2>13. 보호자 전달 메모</h2>
${briefingNote?.trim() ? `<p>${esc(briefingNote.trim())}</p>` : '<p class="empty">작성된 전달 메모가 없습니다.</p>'}

<div class="disclaimer">
  본 레포트는 보호자가 앱에 입력한 관찰 기록을 정리한 문서로, 의학적 진단·소견·처방이 아닙니다.
  기록 누락·오입력이 있을 수 있으므로 진료 시 참고 자료로만 활용해 주세요.
  약 이름과 용법은 보호자가 기록한 내용을 그대로 옮긴 것입니다.
</div>`;
};
