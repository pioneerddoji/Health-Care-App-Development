// 관리 대상자(아이/성인) 판정과 동의 계획 — 유형별 분기의 단일 원천.
//
// 원칙 (docs/08 §확장 시 갈라지는 지점):
//  · 법적 의무는 "앱의 대상군"이 아니라 대상자의 실제 만 나이에서 나온다.
//    그래서 동의 계획은 recipientType 라벨이 아니라 **birthDate 기준 만 나이**로 정한다.
//    (유형 필드는 "무엇을 보여줄지"를, 나이는 "어떤 동의가 필요한지"를 결정)
//  · 건강정보 기록의 게이트는 언제나 sensitive_health 하나다(RLS와 동일) —
//    대상자 유형이 늘어도 이 게이트를 우회하는 경로를 만들지 않는다.
import type { Child, ChildInput, ConsentType, ISODate, RecipientType } from '../types';
import { today } from './date';

/** 만 나이 (생일 기준) */
export const ageOf = (birthDate: ISODate, on: ISODate = today()): number => {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [oy, om, od] = on.split('-').map(Number);
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return Math.max(0, age);
};

/** 저장본 호환: 유형이 없는 기존 행은 아이로 간주 */
export const recipientTypeOf = (r: Pick<Child, 'recipientType'>): RecipientType =>
  r.recipientType ?? 'child';

export const isAdultRecipient = (r: Pick<Child, 'recipientType'>): boolean =>
  recipientTypeOf(r) === 'adult';

/** 연령 전제 기능(출생 정보·학교/기관 기록 등)을 보여줄 대상인가 */
export const showsChildFeatures = (r: Pick<Child, 'recipientType'>): boolean =>
  recipientTypeOf(r) === 'child';

// ── 동의 계획 ────────────────────────────────────────────────
export type ConsentBasis =
  | 'child_under14'   // 만 14세 미만 — 법정대리인 동의 (개인정보 보호법 §22-2)
  | 'minor'           // 만 14세 이상 미성년 — 법정대리인 동의 + 본인 인지
  | 'adult_self'      // 성인 본인 — 본인 동의
  | 'adult_delegated'; // 성인 타인 — 본인 위임 동의 확인 필요

export interface ConsentPlan {
  basis: ConsentBasis;
  /** 등록 시 기록할 동의 유형 — sensitive_health는 항상 포함(RLS 게이트) */
  types: ConsentType[];
  /** 등록 폼에 표시할 확인 문구 */
  notice: string;
  /** 별도 체크가 필요한 확인 문구 (없으면 동의 화면의 포괄 동의로 충분) */
  confirmLabel?: string;
}

/**
 * 대상자 정보로 필요한 동의를 판정한다.
 * 성인이라도 만 나이가 미성년이면 미성년 기준이 우선한다(라벨보다 나이가 우선).
 */
export const consentPlanFor = (
  input: Pick<ChildInput, 'birthDate' | 'recipientType' | 'isSelf'>,
  on: ISODate = today(),
): ConsentPlan => {
  const age = input.birthDate ? ageOf(input.birthDate, on) : 0;

  if (age < 14) {
    return {
      basis: 'child_under14',
      types: ['guardian_legal', 'sensitive_health'],
      notice: '만 14세 미만이므로 법정대리인(부모 등 보호자)의 동의가 필요합니다.',
      confirmLabel: '본인은 이 대상자의 법정대리인이며, 건강정보 기록에 동의합니다.',
    };
  }
  if (age < 19) {
    return {
      basis: 'minor',
      types: ['guardian_legal', 'sensitive_health'],
      notice: '미성년 대상자입니다. 법정대리인 동의와 함께 본인에게도 기록 사실을 알려주세요.',
      confirmLabel: '본인은 법정대리인이며, 대상자 본인도 기록에 동의했음을 확인합니다.',
    };
  }
  if (input.isSelf) {
    return {
      basis: 'adult_self',
      types: ['sensitive_health'],
      notice: '본인의 건강정보를 기록합니다.',
      confirmLabel: '본인의 건강정보 수집·이용에 동의합니다.',
    };
  }
  return {
    basis: 'adult_delegated',
    types: ['adult_delegated', 'sensitive_health'],
    notice: '성인 가족의 건강정보는 그 본인의 동의가 있어야 대신 기록할 수 있습니다.',
    confirmLabel: '대상자 본인에게 동의를 받았음을 확인합니다.',
  };
};
