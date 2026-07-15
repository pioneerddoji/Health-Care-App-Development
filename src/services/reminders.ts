// 예방접종/건강검진 예정일 로컬 알림 — 서버 없이 기기에서 예약(expo-notifications).
// 식별자를 'vacc-<id>' / 'checkup-<id>'로 고정해 수정/완료 시 재예약·취소가 가능하다.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ISODate } from '../types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

let permissionChecked = false;

const ensurePermission = async (): Promise<boolean> => {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  if (current.status === 'denied' && permissionChecked) return false; // 재요청 스팸 방지
  permissionChecked = true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
};

interface ReminderInput {
  id: string;             // 'vacc-<uuid>' | 'checkup-<uuid>'
  title: string;
  body: string;
  dueDate: ISODate;
  daysBefore?: number;     // 기본 1일 전 오전 9시
}

/** 예정일 알림 예약. 이미 지난 날짜거나 권한이 없으면 조용히 건너뛴다. */
export const scheduleDueDateReminder = async (input: ReminderInput): Promise<void> => {
  if (Platform.OS === 'web') return; // 웹은 로컬 알림 미지원
  const granted = await ensurePermission();
  if (!granted) return;

  const fireAt = new Date(`${input.dueDate}T09:00:00`);
  fireAt.setDate(fireAt.getDate() - (input.daysBefore ?? 1));
  if (fireAt.getTime() <= Date.now()) return; // 이미 지난 예정일은 예약하지 않음

  await Notifications.cancelScheduledNotificationAsync(input.id).catch(() => {});
  await Notifications.scheduleNotificationAsync({
    identifier: input.id,
    content: { title: input.title, body: input.body },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });
};

export const cancelReminder = async (id: string): Promise<void> => {
  if (Platform.OS === 'web') return;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
};

/** 알림 권한이 명시적으로 거부된 상태인지 — 화면에서 안내 배너 표시용 */
export const isNotificationDenied = async (): Promise<boolean> => {
  if (Platform.OS === 'web') return false;
  const { status, canAskAgain } = await Notifications.getPermissionsAsync();
  return status === 'denied' && !canAskAgain;
};
