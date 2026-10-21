import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { supabase } from '../services/supabase';
import { updatePassword } from '../services/api';
import { Button, Field, Screen } from '../components/ui';
import Logo from '../components/Logo';
import { Colors, Space, Type } from '../theme';

export default function ResetPassword() {
  const router = useRouter(); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function restoreResetSession(url) {
      if (!url) {
        const { data } = await supabase.auth.getSession();
        if (mounted) setSessionReady(Boolean(data.session));
        return;
      }
      const parsed = Linking.parse(url);
      const query = parsed.queryParams || {};
      const hash = url.split('#')[1] || '';
      const hashParams = new URLSearchParams(hash);
      const accessToken = query.access_token || hashParams.get('access_token');
      const refreshToken = query.refresh_token || hashParams.get('refresh_token');
      const code = query.code;
      if (code) await supabase.auth.exchangeCodeForSession(String(code));
      else if (accessToken && refreshToken) {
        await supabase.auth.setSession({
          access_token: String(accessToken),
          refresh_token: String(refreshToken),
        });
      }
      const { data } = await supabase.auth.getSession();
      if (mounted) {
        setSessionReady(Boolean(data.session));
        if (!data.session) setError('This reset link is invalid or expired. Request a new one.');
      }
    }
    Linking.getInitialURL().then(restoreResetSession).catch(() => {
      if (mounted) setError('Could not open the reset link. Request a new one.');
    });
    const subscription = Linking.addEventListener('url', ({ url }) => {
      restoreResetSession(url).catch(() => {
        if (mounted) setError('Could not open the reset link. Request a new one.');
      });
    });
    return () => { mounted = false; subscription.remove(); };
  }, []);
  async function submit() { if (!sessionReady) return setError('Open the reset link from your email first'); if (password.length < 6) return setError('Use at least 6 characters'); if (password !== confirm) return setError('Passwords do not match'); setLoading(true); setError(''); try { await updatePassword(password); await supabase.auth.signOut({ scope: 'local' }); router.replace('/login'); } catch (e) { setError(e.message || 'Could not update password'); } finally { setLoading(false); } }
  return <Screen><SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.scroll}><Logo caption="Choose a new password" /><View style={styles.form}><Field label="New password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" error={error} /><Field label="Confirm password" icon="lock-closed-outline" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" /><Button label="Update password" onPress={submit} loading={loading} disabled={!sessionReady} /></View></ScrollView></KeyboardAvoidingView></SafeAreaView></Screen>;
}
const styles = StyleSheet.create({ safe: { flex: 1 }, scroll: { flexGrow: 1, justifyContent: 'center', padding: Space.xl }, form: { marginTop: Space.xxl } });
