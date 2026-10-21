import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { Colors, Type } from '../../theme';
import InAppAlertOverlay from '../../components/InAppAlertOverlay';

const TABS = [
  { name: 'index', title: 'Home', icon: 'shield' },
  { name: 'history', title: 'History', icon: 'time' },
  { name: 'profile', title: 'Profile', icon: 'person' },
];

export default function TabsLayout() {
  return (
    <>
      <Tabs
        screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.danger,
        tabBarInactiveTintColor: Colors.subtle,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.divider,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 86 : 66,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },
        tabBarLabelStyle: { ...Type.overline, letterSpacing: 0.4 },
        sceneStyle: { backgroundColor: Colors.bg },
      }}
    >
        {TABS.map(({ name, title, icon }) => (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title,
              tabBarIcon: ({ color, focused, size }) => (
                <Ionicons name={focused ? icon : `${icon}-outline`} size={size ?? 22} color={color} />
              ),
            }}
          />
        ))}
      </Tabs>
      <InAppAlertOverlay />
    </>
  );
}
