import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  getStoredUser, logout, getProfileStats, getActiveSOS, clearMyActiveSOS,
  DEFAULT_SOS_RANGE_KM,
} from '../../services/api';
import { parseServerDate } from '../../services/format';
import { Avatar, Button, Card, Overline, Pill, Screen, Stat } from '../../components/ui';
import ConnectionBanner from '../../components/ConnectionBanner';
import ContactsCard from '../../components/ContactsCard';
import { registerForPush } from '../../services/notifications';
import { Colors, Space, Type } from '../../theme';

export default function Profile() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({ sosSent: 0, timesHelped: 0, memberSince: null });
  const [loading, setLoading] = useState(true);
  const [hasActive, setHasActive] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [push, setPush] = useState(null);

  useEffect(() => { load(); }, []);

  // Coming back to this tab should show the current state, not a stale one.
  useFocusEffect(
    React.useCallback(() => {
      getActiveSOS()
        .then((active) => setHasActive(Boolean(active.active)))
        .catch(() => {});
    }, [])
  );

  async function load() {
    try {
      setUser(await getStoredUser());
      const profileStats = await getProfileStats();
      const stored = await getStoredUser();
      setStats({
        ...profileStats,
        sosSent: profileStats.sosSent ?? profileStats.totalSOS ?? 0,
        timesHelped: profileStats.timesHelped ?? profileStats.helped ?? 0,
        memberSince: profileStats.memberSince ?? stored?.created_at ?? null,
        rangeKm: profileStats.rangeKm ?? DEFAULT_SOS_RANGE_KM,
      });
      const active = await getActiveSOS();
      setHasActive(Boolean(active.active));
    } catch {}
    setLoading(false);
    setPush(await registerForPush());
  }

  function confirmClear() {
    Alert.alert(
      'Clear your SOS history state?',
      'Any SOS still marked as running will be closed, so you can send a new one. '
      + 'Your past emergencies stay in History.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear it', style: 'destructive', onPress: clearStuck },
      ]
    );
  }

  /**
   * The way out when the app insists an SOS is running but no screen shows it.
   */
  async function clearStuck() {
    setClearing(true);
    try {
      const result = await clearMyActiveSOS();
      setHasActive(false);
      await load();
      Alert.alert(
        result.cleared ? 'Cleared' : 'Nothing to clear',
        result.cleared
          ? `${result.cleared} SOS closed. You can send a new one now.`
          : 'You have no SOS running. You can send one any time.'
      );
    } catch (err) {
      Alert.alert('Could not clear it', err.message);
    } finally {
      setClearing(false);
    }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will stop receiving emergency alerts from people nearby.', [
      { text: 'Stay signed in', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.danger} />
        </View>
      </Screen>
    );
  }

  const since = parseServerDate(stats.memberSince);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ConnectionBanner />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.pageHeader}>
            <View>
              <Overline>RESQORA</Overline>
              <Text style={styles.pageTitle}>Your profile</Text>
            </View>
            <Pill label="Protected" icon="shield-checkmark" tone="safe" />
          </View>
          <View style={styles.identity}>
            <Avatar name={user?.name} size={80} tone="danger" />
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.phone}>{user?.email || user?.phone || 'Email not available'}</Text>
          </View>

          <Card style={styles.stats}>
            <Stat value={stats.sosSent} label="SOS sent" tone="danger" />
            <View style={styles.divider} />
            <Stat value={stats.timesHelped} label="People helped" tone="safe" />
          </Card>

          <Card style={styles.rows}>
            <Row icon="mail-outline" label="Email" value={user?.email || user?.phone || '—'} />
            <View style={styles.rowDivider} />
            <Row
              icon="radio-outline"
              label="Alert radius"
              value={`${stats.rangeKm || DEFAULT_SOS_RANGE_KM} km`}
            />
            <View style={styles.rowDivider} />
            <Row
              icon="calendar-outline"
              label="Member since"
              value={since ? since.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Active account'}
            />
          </Card>

          <Card style={styles.accountCard}>
            <Overline>Account security</Overline>
            <View style={styles.securityRow}>
              <View style={styles.securityIcon}><Ionicons name="lock-closed" size={17} color={Colors.safe} /></View>
              <View style={styles.securityCopy}>
                <Text style={styles.securityTitle}>Supabase Auth protected</Text>
                <Text style={styles.privacyText}>Email recovery is available if you forget your password.</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={Colors.safe} />
            </View>
          </Card>

          <Card style={styles.privacy} tone={push && push.status !== 'registered' ? 'danger' : undefined}>
            <Overline>Background alerts</Overline>
            <Text style={styles.privacyText}>
              {!push ? 'Checking…'
                : push.status === 'registered'
                  ? 'This phone can receive emergency alerts while the app is closed.'
                  : `${push.reason} You will still be alerted while RESQORA is open.`}
            </Text>
            {push && push.status !== 'registered' && (
              <Button
                label="Try again"
                icon="notifications"
                variant="outline"
                tone="danger"
                onPress={async () => setPush(await registerForPush())}
              />
            )}
          </Card>

          <ContactsCard />

          <Card style={styles.privacy} tone={hasActive ? 'danger' : undefined}>
            <Overline>{hasActive ? 'You have an SOS running' : 'Stuck SOS'}</Overline>
            <Text style={styles.privacyText}>
              {hasActive
                ? 'An emergency of yours is still open. Clear it if you are safe and '
                  + 'the live screen is not showing.'
                : 'If the app ever says you already have an SOS running but no screen '
                  + 'shows it, clear it here.'}
            </Text>
            <Button
              label={clearing ? 'Clearing…' : 'Clear active SOS'}
              icon="refresh"
              variant="outline"
              tone={hasActive ? 'danger' : 'neutral'}
              onPress={confirmClear}
              disabled={clearing}
            />
          </Card>

          <Card style={styles.privacy}>
            <Overline>Your location</Overline>
            <Text style={styles.privacyText}>
              Shared only while an SOS is running, and only with people inside your radius.
              Ending the SOS stops it immediately.
            </Text>
          </Card>

          <Button
            label="Sign out"
            icon="log-out-outline"
            variant="outline"
            tone="danger"
            onPress={confirmSignOut}
            style={styles.signOut}
          />
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function Row({ icon, label, value }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={18} color={Colors.subtle} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Space.xl, gap: Space.lg, paddingBottom: Space.xxl },

  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Space.sm },
  pageTitle: { ...Type.title, color: Colors.text, marginTop: Space.xs },

  identity: { alignItems: 'center', gap: Space.xs, marginBottom: Space.sm },
  name: { ...Type.title, color: Colors.text, marginTop: Space.md },
  phone: { ...Type.body, color: Colors.muted },

  stats: { flexDirection: 'row', padding: 0 },
  divider: { width: 1, backgroundColor: Colors.divider, marginVertical: Space.lg },

  rows: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  rowDivider: { height: 1, backgroundColor: Colors.divider, marginHorizontal: Space.lg },
  rowLabel: { flex: 1, ...Type.body, color: Colors.muted },
  rowValue: { ...Type.bodyStrong, color: Colors.text },

  privacy: { gap: Space.sm },
  privacyText: { ...Type.caption, color: Colors.muted },

  accountCard: { gap: Space.md },
  securityRow: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  securityIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.safeSoft, alignItems: 'center', justifyContent: 'center' },
  securityCopy: { flex: 1, gap: 2 },
  securityTitle: { ...Type.bodyStrong, color: Colors.text },

  signOut: { marginTop: Space.sm },
});
