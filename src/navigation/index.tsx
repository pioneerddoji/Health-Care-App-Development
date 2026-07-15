import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ChildListScreen } from '../screens/children/ChildListScreen';
import { ChildFormScreen } from '../screens/children/ChildFormScreen';
import { ChildProfileScreen } from '../screens/children/ChildProfileScreen';
import { DayRecordsScreen } from '../screens/records/DayRecordsScreen';
import { RecordFormScreen } from '../screens/records/RecordFormScreen';
import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { CalendarScreen } from '../screens/dashboard/CalendarScreen';
import { ReportScreen } from '../screens/report/ReportScreen';
import { VaccinationScreen } from '../screens/vaccination/VaccinationScreen';
import { SettingsScreen } from '../screens/settings/SettingsScreen';
import { PrivacyPolicyScreen } from '../screens/settings/PrivacyPolicyScreen';
import { PaywallScreen } from '../screens/settings/PaywallScreen';
import { tokens } from '../components/ui';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const TABS = [
  { name: '홈', component: ChildListScreen, icon: '🏠' },
  { name: '기록', component: DayRecordsScreen, icon: '✏️' },
  { name: '대시보드', component: DashboardScreen, icon: '📊' },
  { name: '레포트', component: ReportScreen, icon: '📄' },
];

const Tabs = () => (
  <Tab.Navigator
    screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: tokens.primary,
      tabBarInactiveTintColor: tokens.muted,
      tabBarStyle: { backgroundColor: tokens.surface },
    }}
  >
    {TABS.map((t) => (
      <Tab.Screen
        key={t.name}
        name={t.name}
        component={t.component}
        options={{ tabBarIcon: () => <Text style={{ fontSize: 18 }}>{t.icon}</Text> }}
      />
    ))}
  </Tab.Navigator>
);

export const AppNavigation = () => (
  <NavigationContainer>
    <Stack.Navigator
      screenOptions={{
        headerTintColor: tokens.ink,
        headerStyle: { backgroundColor: tokens.surface },
        headerTitleStyle: { fontWeight: '700' },
      }}
    >
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="ChildForm" component={ChildFormScreen} options={{ title: '아이 프로필' }} />
      <Stack.Screen name="ChildProfile" component={ChildProfileScreen} options={{ title: '프로필' }} />
      <Stack.Screen name="RecordForm" component={RecordFormScreen} options={{ title: '기록 추가' }} />
      <Stack.Screen name="Calendar" component={CalendarScreen} options={{ title: '캘린더' }} />
      <Stack.Screen name="Vaccination" component={VaccinationScreen} options={{ title: '예방접종 · 검진' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '설정' }} />
      <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} options={{ title: '개인정보처리방침' }} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ title: '플랜 관리' }} />
    </Stack.Navigator>
  </NavigationContainer>
);
