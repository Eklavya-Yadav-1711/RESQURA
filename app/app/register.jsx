import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { register, DEFAULT_SOS_RANGE_KM } from '../services/api';
import { Button, Field, Screen } from '../components/ui';
import Logo from '../components/Logo';
import { Colors, Space, Radius, Type } from '../theme';

export default function Register() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
  }

  async function handleRegister() {
    const next = {};
    if (!form.name.trim()) next.name = 'Responders see this name when you call for help';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    if (form.password.length < 4) next.password = 'Use at least 4 characters';
    setErrors(next);
    if (Object.keys(next).length) return;

    setLoading(true);
    try {
      await register(form.name.trim(), form.email.trim().toLowerCase(), form.password);
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
            <Logo caption="Join the network around you" />

            <View style={styles.form}>
              <Field
                label="Full name"
                icon="person-outline"
                placeholder="Your name"
                value={form.name}
                onChangeText={(v) => set('name', v)}
                autoComplete="name"
                textContentType="name"
                error={errors.name}
              />

              <Field
                label="Email address"
                icon="mail-outline"
                placeholder="you@example.com"
                value={form.email}
                onChangeText={(v) => set('email', v)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                textContentType="emailAddress"
                error={errors.email}
              />

              <Field
                label="Password"
                icon="lock-closed-outline"
                placeholder="At least 4 characters"
                value={form.password}
                onChangeText={(v) => set('password', v)}
                secureTextEntry
                autoComplete="new-password"
                textContentType="newPassword"
                error={errors.password}
                onSubmitEditing={handleRegister}
              />

              <Button label="Create account" onPress={handleRegister} loading={loading} />
            </View>

            <View style={styles.notice}>
              <Ionicons name="location-outline" size={16} color={Colors.subtle} />
              <Text style={styles.noticeText}>
                Your location is shared only while you have an SOS running, and only with
                people within {DEFAULT_SOS_RANGE_KM} km.
              </Text>
            </View>

            <Pressable
              onPress={() => router.replace('/login')}
              accessibilityRole="link"
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                Already registered? <Text style={styles.switchLink}>Sign in</Text>
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
  notice: {
    flexDirection: 'row', gap: Space.md, alignItems: 'flex-start',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, padding: Space.lg, marginTop: Space.sm,
  },
  noticeText: { flex: 1, ...Type.caption, color: Colors.muted },
  switch: { alignItems: 'center', paddingVertical: Space.lg },
  switchText: { ...Type.body, color: Colors.muted },
  switchLink: { color: Colors.danger, fontFamily: Type.bodyStrong.fontFamily },
});
