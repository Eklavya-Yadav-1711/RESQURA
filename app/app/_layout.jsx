import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter';
import { getStoredUser } from '../services/api';
import { Colors } from '../theme';

const AUTH_ROUTES = ['login', 'register', 'forgot-password', 'reset-password'];

/**
 * Sends you to the right place once, at startup. It deliberately ignores any
 * screen you are already deep inside — an SOS in progress must never be
 * yanked back to the dashboard.
 */
function AuthGate() {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    let cancelled = false;
    getStoredUser()
      .then((user) => {
        if (cancelled) return;
        const root = segments[0];
        const onAuth = AUTH_ROUTES.includes(root);
        const atEntry = !root || root === 'index' || root === 'home';

        const canResetPassword = root === 'reset-password';
        if (user && ((onAuth && !canResetPassword) || atEntry)) router.replace('/(tabs)');
        else if (!user && !onAuth) router.replace('/login');
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      });
    return () => { cancelled = true; };
  }, [router, segments]);

  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
  });
  const [timedOut, setTimedOut] = useState(false);

  // Never let a slow font load hold an emergency app hostage.
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!fontsLoaded && !timedOut) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={Colors.danger} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaProvider style={styles.root}>
        <StatusBar style="light" backgroundColor={Colors.bg} />
        <AuthGate />
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            animationDuration: 160,
            contentStyle: { backgroundColor: Colors.bg },
          }}
        >
          <Stack.Screen name="login" options={{ gestureEnabled: false }} />
          <Stack.Screen name="sos-active" options={{ gestureEnabled: false }} />
        </Stack>
      </SafeAreaProvider>
    </View>
  );
}

// A release build cannot show Metro's red error screen. Keep a startup or
// screen-level exception actionable instead of leaving the user on a blank
// Android surface.
export function ErrorBoundary({ error, retry }) {
  return (
    <View style={[styles.root, styles.error]}>
      <Text style={styles.errorTitle}>RESQORA could not open</Text>
      <Text style={styles.errorBody}>
        Please try again. If this keeps happening, reinstall the latest app update.
      </Text>
      <Pressable accessibilityRole="button" onPress={retry} style={styles.retryButton}>
        <Text style={styles.retryText}>Try again</Text>
      </Pressable>
      {__DEV__ ? <Text style={styles.errorDetail}>{error?.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { alignItems: 'center', justifyContent: 'center', padding: 28 },
  errorTitle: { color: Colors.text, fontSize: 22, fontWeight: '700', marginBottom: 10 },
  errorBody: { color: Colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 300 },
  retryButton: { backgroundColor: Colors.danger, borderRadius: 12, marginTop: 24, minHeight: 48, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: Colors.onColor, fontSize: 15, fontWeight: '700' },
  errorDetail: { color: Colors.subtle, fontSize: 12, marginTop: 20, textAlign: 'center' },
});
