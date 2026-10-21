import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { requestPasswordReset } from '../services/api';
import { Button, Field, Screen } from '../components/ui';
import Logo from '../components/Logo';
import { Colors, Space, Type } from '../theme';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Enter a valid email address'); return; }
    setLoading(true); setError('');
    try { await requestPasswordReset(email); setSent(true); }
    catch (e) { setError(e.message || 'Could not send the reset email'); }
    finally { setLoading(false); }
  }

  return <Screen><SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Logo caption="Reset your RESQORA password" />
        {!sent ? <View style={styles.form}>
          <Text style={styles.help}>Enter your email and Supabase will send you a secure reset link.</Text>
          <Field label="Email address" icon="mail-outline" placeholder="you@example.com" value={email} onChangeText={(v) => { setEmail(v); setError(''); }} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" error={error} />
          <Button label="Send reset link" onPress={submit} loading={loading} />
        </View> : <View style={styles.success}><Text style={styles.successTitle}>Check your email</Text><Text style={styles.help}>If an account exists for that address, you will receive a password reset link.</Text></View>}
        <Pressable onPress={() => router.replace('/login')} style={styles.switch}><Text style={styles.switchText}>Back to <Text style={styles.switchLink}>Sign in</Text></Text></Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView></Screen>;
}

const styles = StyleSheet.create({ safe: { flex: 1 }, scroll: { flexGrow: 1, justifyContent: 'center', padding: Space.xl }, form: { marginTop: Space.xxl }, help: { ...Type.body, color: Colors.muted, marginBottom: Space.lg, lineHeight: 23 }, success: { marginTop: Space.xxl }, successTitle: { ...Type.h2, color: Colors.text, marginBottom: Space.md }, switch: { alignItems: 'center', paddingVertical: Space.lg }, switchText: { ...Type.body, color: Colors.muted }, switchLink: { color: Colors.danger, fontFamily: Type.bodyStrong.fontFamily } });
