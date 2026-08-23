// Supabase 클라이언트. env가 비어 있으면 null을 반환하고
// 앱은 인메모리(mock) 모드로 동작한다 — services 계층에서 분기.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { sessionStorage } from './secureSessionStorage';

const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  (Constants.expoConfig?.extra?.supabaseUrl as string | undefined);
const anonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  (Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined);

/** 공유 링크 URL 조립용 (Edge Function 엔드포인트) */
export const supabaseUrl = url ?? null;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // 네이티브: SecureStore 키 기반 암호화 저장 / 웹: AsyncStorage 폴백
          storage: sessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          // 재설정 링크의 recovery 세션을 웹에서 수신한다. OAuth는 supabaseRepo가
          // openAuthSessionAsync 결과를 명시적으로 setSession 하므로 이 옵션과 충돌하지 않는다.
          detectSessionInUrl: true,
        },
      })
    : null;

export const isMockMode = supabase === null;
