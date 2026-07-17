// Supabase 세션(리프레시 토큰 포함) 저장 어댑터 — 평문 AsyncStorage 대체.
//
// SecureStore(키체인/Keystore)는 값당 2KB 제한이 있어 세션 JSON을 직접 넣을 수
// 없다 → AES-256-CTR 암호화 키만 SecureStore에 보관하고, 암호문은 AsyncStorage에
// 저장한다(Supabase 공식 권장 패턴). 기기 저장소가 유출돼도 암호문뿐이라 안전.
//  - 네이티브: 암호화 저장 (아래 encryptedStorage)
//  - 웹: SecureStore가 없으므로 기존 AsyncStorage(localStorage) 그대로 — UI 검증 전용
//  - 구버전 평문 세션: 복호화 키가 없고 값이 JSON이면 1회 그대로 수용
//    (다음 저장부터 암호화) — 기존 로그인 유지
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as aesjs from 'aes-js';

interface KVStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// SecureStore 키는 영숫자와 . - _ 만 허용
const secureKeyFor = (key: string) => `sess.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;

const encryptedStorage: KVStorage = {
  async getItem(key) {
    const [keyHex, cipherHex] = await Promise.all([
      SecureStore.getItemAsync(secureKeyFor(key)),
      AsyncStorage.getItem(key),
    ]);
    if (!cipherHex) return null;
    if (!keyHex) {
      // 구버전 평문 세션 마이그레이션 — supabase-js가 곧 재저장(암호화)한다
      return cipherHex.startsWith('{') ? cipherHex : null;
    }
    try {
      const cipher = new aesjs.ModeOfOperation.ctr(
        aesjs.utils.hex.toBytes(keyHex), new aesjs.Counter(1));
      return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(cipherHex)));
    } catch {
      return null; // 손상된 저장본 — 세션 없음으로 처리(재로그인)
    }
  },

  async setItem(key, value) {
    const encryptionKey = Crypto.getRandomBytes(32); // 저장할 때마다 새 키
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const cipherHex = aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
    await SecureStore.setItemAsync(secureKeyFor(key), aesjs.utils.hex.fromBytes(encryptionKey));
    await AsyncStorage.setItem(key, cipherHex);
  },

  async removeItem(key) {
    await Promise.all([
      SecureStore.deleteItemAsync(secureKeyFor(key)),
      AsyncStorage.removeItem(key),
    ]);
  },
};

export const sessionStorage: KVStorage =
  Platform.OS === 'web' ? AsyncStorage : encryptedStorage;
