import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/context/AppContext';
import { AppNavigation } from './src/navigation';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { SignUpScreen } from './src/screens/auth/SignUpScreen';
import { FindAccountScreen } from './src/screens/auth/FindAccountScreen';
import { ConsentScreen } from './src/screens/auth/ConsentScreen';
import { tokens } from './src/components/ui';

// ── 웹 OAuth 팝업 완결 처리 ──────────────────────────────────
// 웹에서 소셜 로그인은 팝업으로 돈다. 팝업이 인증을 마치고 우리 주소로 돌아오면
// 그 팝업 안에서 이 앱 번들이 **다시 한 번** 로드되는데, 이때 부모 창에
// postMessage 로 결과를 넘겨 주는 것이 maybeCompleteAuthSession() 이다.
// 호출하지 않으면 부모 창의 openAuthSessionAsync() 가 영원히 기다리고,
// 사용자가 팝업을 닫으면 'dismiss' 로 떨어져 "카카오 로그인이 취소되었습니다"
// 가 뜬다 — 설정이 다 맞아도 웹에서는 절대 로그인되지 않는다.
//
// 네이티브에서는 이 API 자체가 없어 라이브러리가 무해하게 무시한다
// (expo-web-browser: `if (ExponentWebBrowser.maybeCompleteAuthSession)`).
// 컴포넌트 안이 아니라 모듈 스코프에 두는 이유는, 팝업에서 로드될 때
// React 트리가 그려지기 전에 최대한 빨리 부모에게 알려야 하기 때문이다.
WebBrowser.maybeCompleteAuthSession();

const Gate = () => {
  const { booting, guardian, consented, grantConsents } = useApp();
  const [mode, setMode] = useState<'login' | 'signup' | 'find'>('login');

  // 로그아웃(guardian → null) 시 항상 로그인 화면으로 복귀
  useEffect(() => {
    if (!guardian) setMode('login');
  }, [guardian]);

  if (booting) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={tokens.primary} />
      </View>
    );
  }
  if (!guardian) {
    if (mode === 'signup') return <SignUpScreen onBack={() => setMode('login')} />;
    if (mode === 'find') return <FindAccountScreen onBack={() => setMode('login')} />;
    return <LoginScreen onGoSignUp={() => setMode('signup')} onGoFind={() => setMode('find')} />;
  }
  if (!consented) return <ConsentScreen onComplete={grantConsents} />;
  return <AppNavigation />;
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: tokens.bg }} edges={['top']}>
          <StatusBar style="dark" />
          <Gate />
        </SafeAreaView>
      </AppProvider>
    </SafeAreaProvider>
  );
}
