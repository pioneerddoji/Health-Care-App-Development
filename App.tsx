import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/context/AppContext';
import { AppNavigation } from './src/navigation';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { SignUpScreen } from './src/screens/auth/SignUpScreen';
import { FindAccountScreen } from './src/screens/auth/FindAccountScreen';
import { ConsentScreen } from './src/screens/auth/ConsentScreen';
import { tokens } from './src/components/ui';

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
