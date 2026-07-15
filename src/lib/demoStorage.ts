// 데모 모드 영속화용 저장 어댑터.
// RN/웹에서는 AsyncStorage(기기 저장/localStorage), Node 테스트 환경처럼
// AsyncStorage를 로드할 수 없는 곳에서는 인메모리 폴백으로 조용히 동작한다.
interface KVStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const memoryFallback = (): KVStorage => {
  const m = new Map<string, string>();
  return {
    async getItem(k) { return m.get(k) ?? null; },
    async setItem(k, v) { m.set(k, v); },
    async removeItem(k) { m.delete(k); },
  };
};

let storage: KVStorage;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  storage = require('@react-native-async-storage/async-storage').default as KVStorage;
} catch {
  storage = memoryFallback();
}

export const demoStorage: KVStorage = {
  getItem: (k) => storage.getItem(k).catch(() => null),
  setItem: (k, v) => storage.setItem(k, v).catch(() => {}),
  removeItem: (k) => storage.removeItem(k).catch(() => {}),
};
