import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { login } from '../services/api';
import { Button, Field, Screen } from '../components/ui';
import Logo from '../components/Logo';
import { Colors, Space, Type } from '../theme';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    const next = {};
    if (!email.trim() || !email.includes('@')) next.email = 'Enter a valid email address';
    if (!password) next.password = 'Enter your password';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace('/(tabs)');
    } catch (err) {
      setErrors({ email: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <Logo caption="Help from the people closest to you" />

            <View style={styles.form}>
              <Field
                label="Email address"
                icon="mail-outline"
                placeholder="you@example.com"
                value={email}
                onChangeText={(v) => { setEmail(v); setErrors((e) => ({ ...e, email: null })); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                error={errors.email}
                returnKeyType="next"
              />

              <Field
                label="Password"
                icon="lock-closed-outline"
                placeholder="Your password"
                value={password}
                onChangeText={(v) => { setPassword(v); setErrors((e) => ({ ...e, password: null })); }}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                error={errors.password}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />

              <Button label="Sign in" onPress={handleLogin} loading={loading} />
              <Pressable onPress={() => router.push('/forgot-password')} style={styles.forgot}>
                <Text style={styles.switchLink}>Forgot password?</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => router.push('/register')}
              accessibilityRole="link"
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                New here? <Text style={styles.switchLink}>Create an account</Text>
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Space.xl },
  form: { marginTop: Space.xxl },
  forgot: { alignItems: 'center', paddingVertical: Space.md },
  switch: { alignItems: 'center', paddingVertical: Space.lg, marginTop: Space.sm },
  switchText: { ...Type.body, color: Colors.muted },
  switchLink: { color: Colors.danger, fontFamily: Type.bodyStrong.fontFamily },
});
