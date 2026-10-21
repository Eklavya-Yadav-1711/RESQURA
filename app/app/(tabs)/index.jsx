import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Vibration, Pressable,
  AccessibilityInfo, RefreshControl, AppState,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect, useSegments } from 'expo-router';
import * as Location from 'expo-location';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getStoredUser, connectSocket, sendLocationUpdate, getNearbyUsers, getOnlineCount,
  cacheSOSAlert, getSOSImageSource, getActiveSOS, getIncomingSOS, DEFAULT_SOS_RANGE_KM,
} from '../../services/api';
import { formatKm } from '../../services/format';
import { registerForPush, onNotificationOpened } from '../../services/notifications';
import { Avatar, Button, Card, EmptyState, Overline, Pill, Screen, Stat } from '../../components/ui';
import ConnectionBanner from '../../components/ConnectionBanner';
import Photo from '../../components/Photo';
import SafetyTimer from '../../components/SafetyTimer';
import NearestHelp from '../../components/NearestHelp';
import { Colors, Space, Radius, Type, Motion, HIT } from '../../theme';

export default function Home() {
  const router = useRouter();
  const segments = useSegments();
  const alertSound = useAudioPlayer(require('../../assets/alert.wav'));
  const [user, setUser] = useState(null);
  const [located, setLocated] = useState(false);
  const [location, setLocation] = useState(null);
  const [nearby, setNearby] = useState([]);
  const [online, setOnline] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [alert, setAlert] = useState(null);

  const sheetY = useRef(new Animated.Value(400)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const watcher = useRef(null);
  const lastFix = useRef(null);
  const dismissed = useRef(new Set());
  const showing = useRef(null);
  const routeRef = useRef(segments);

  useEffect(() => {
    routeRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (!alert) return undefined;
    sheetY.setValue(400);
    const animation = Animated.spring(sheetY, {
      toValue: 0, useNativeDriver: true, tension: 60, friction: 11,
    });
    animation.start();
    return () => animation.stop();
  }, [alert, sheetY]);

  useEffect(() => {
    // Respect the system setting rather than pulsing at everyone.
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (!on) startHalo(); });
    init();

    // An alert that fired while the app was closed is not in any socket
    // buffer — ask the server what is still live every time we come back.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });

    // Realtime is a convenience, not the delivery guarantee. A short
    // foreground check makes the alert sheet appear even when a device has
    // briefly lost its Realtime connection or the database stream is delayed.
    const incomingCheck = setInterval(catchUp, 3000);

    // Tapping a background alert jumps straight into responding.
    const unsubscribe = onNotificationOpened((data) => {
      router.push({
        pathname: '/responder-nav',
        params: {
          sosId: String(data.sosId),
          victimLat: String(data.location?.lat ?? ''),
          victimLon: String(data.location?.lon ?? ''),
          victimName: data.victimName ?? '',
        },
      });
    });

    return () => {
      watcher.current?.remove();
      unsubscribe();
      appState.remove();
      clearInterval(incomingCheck);
    };
  }, []);

  // Landing back on Home while your own SOS is live means something went
  // wrong (a stray back press, a restart) — return to it.
  useFocusEffect(
    React.useCallback(() => { catchUp(); }, [])
  );

  async function init() {
    const stored = await getStoredUser();
    if (!stored) return;
    setUser(stored);

    const socket = connectSocket(stored.id);
    socket.off('sos_alert').on('sos_alert', receiveAlert);
    socket.off('online_count').on('online_count', (d) => setOnline(d.count));
    socket.off('sos_ended').on('sos_ended', clearIfEnded);
    getOnlineCount().then(setOnline);

    catchUp();

    trackLocation();
    registerForPush();   // result is surfaced on the Profile tab
  }

  async function trackLocation() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      handleFix(fix);

      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 10000 },
        handleFix
      );
    } catch {}
  }

  function handleFix({ coords }) {
    const { latitude: lat, longitude: lon } = coords;
    lastFix.current = { lat, lon };
    setLocated(true);
    setLocation((prev) => (prev && prev.lat === lat && prev.lon === lon ? prev : { lat, lon }));
    sendLocationUpdate(lat, lon);
    loadNearby(lat, lon);
  }

  const loadNearby = useCallback(async (lat, lon) => {
    try {
      const data = await getNearbyUsers(lat, lon, DEFAULT_SOS_RANGE_KM);
      setNearby(data.users || []);
    } catch {}
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    const fix = lastFix.current;
    await Promise.all([
      fix ? loadNearby(fix.lat, fix.lon) : Promise.resolve(),
      getOnlineCount().then(setOnline),
      catchUp(),
    ]);
    setRefreshing(false);
  }

  /** Pulls any still-live emergency: your own first, then ones near you. */
  async function catchUp() {
    try {
      const mine = await getActiveSOS();
      const alreadyOnActiveSOS = routeRef.current.includes('sos-active');
      if (mine.active && !alreadyOnActiveSOS) {
        router.replace({
          pathname: '/sos-active',
          params: {
            sosId: String(mine.sos.id),
            startedAt: mine.sos.started_at || mine.sos.startedAt || '',
            alertedCount: String(Array.isArray(mine.responders) ? mine.responders.length : 0),
          },
        });
        return;
      }
    } catch {}

    try {
      const data = await getIncomingSOS();
      // The deployed Supabase function returns raw SOS sessions as `sos`,
      // while the Socket.IO API returns ready-to-display records as `alerts`.
      // Accept both shapes during the rollout so an emergency is never hidden.
      const rawAlerts = Array.isArray(data.alerts) ? data.alerts : [];
      const legacySOS = Array.isArray(data.sos) ? data.sos : [];
      const alerts = rawAlerts.length ? rawAlerts : legacySOS.map((sos) => ({
        sosId: sos.sosId || sos.id,
        victim: sos.victim || { id: sos.victim_id, name: 'Someone nearby' },
        message: sos.message,
        imageUrl: sos.imageUrl || sos.image_url || null,
        location: sos.location || { lat: Number(sos.victim_lat), lon: Number(sos.victim_lon) },
        distance: sos.distance ?? null,
        range: sos.range ?? Number(sos.range_km),
        responderStatus: sos.responderStatus || 'alerted',
      }));
      const pending = alerts.find((a) => !dismissed.current.has(String(a.sosId)));
      if (pending && String(pending.sosId) !== String(showing.current)) {
        receiveAlert({ ...pending, resumed: true });
      }
    } catch {}
  }

  function clearIfEnded(data) {
    dismissed.current.delete(String(data.sosId));
    if (String(showing.current) === String(data.sosId)) dismissAlert();
  }

  async function receiveAlert(data) {
    const alertData = normalizeAlert(data);
    if (!alertData?.sosId || !alertData.location) return;
    cacheSOSAlert(alertData);
    showing.current = String(alertData.sosId);
    setAlert(alertData);

    AccessibilityInfo.announceForAccessibility?.(
      `Emergency alert. ${alertData.victim?.name} needs help ${formatKm(alertData.distance)} away.`
    );

    // A replayed alert is not news — show it, but do not re-run the siren.
    if (data.resumed) return;

    Vibration.vibrate([0, 400, 180, 400, 180, 400]);
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      await alertSound.seekTo(0);
      alertSound.volume = 1;
      alertSound.play();
    } catch {}
  }

  function normalizeAlert(data) {
    if (!data) return null;
    const location = data.location || {
      lat: Number(data.victim_lat),
      lon: Number(data.victim_lon),
    };
    const lat = Number(location?.lat);
    const lon = Number(location?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      ...data,
      sosId: data.sosId || data.id,
      victim: data.victim || {
        id: data.victim_id,
        name: data.victim_name || data.users?.name || 'Someone nearby',
      },
      message: data.message || 'Someone nearby needs help.',
      location: { lat, lon },
      distance: Number.isFinite(Number(data.distance)) ? Number(data.distance) : null,
    };
  }

  function dismissAlert() {
    if (showing.current) dismissed.current.add(String(showing.current));
    showing.current = null;
    Animated.timing(sheetY, {
      toValue: 400, duration: Motion.fast, useNativeDriver: true,
    }).start(() => setAlert(null));
  }

  function respond() {
    if (!alert) return;
    router.push({
      pathname: '/responder-nav',
      params: {
        sosId: String(alert.sosId),
        victimLat: String(alert.location.lat),
        victimLon: String(alert.location.lon),
        victimName: alert.victim?.name ?? '',
      },
    });
    showing.current = null;
    setAlert(null);
    sheetY.setValue(400);
  }

  function startHalo() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(300),
      ])
    ).start();
  }

  const haloStyle = {
    transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.75] }) }],
    opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
  };

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ConnectionBanner />
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.danger} />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.greeting}>Hello</Text>
              <Text style={styles.name} numberOfLines={1}>{user?.name || 'there'}</Text>
            </View>
            <Avatar name={user?.name} size={46} tone="danger" />
          </View>

          <View style={styles.statusRow}>
            <Pill label="Protected" tone="safe" icon="shield-checkmark" />
            <Pill
              label={located ? 'GPS locked' : 'Finding you'}
              tone={located ? 'info' : 'neutral'}
              icon={located ? 'navigate' : 'navigate-outline'}
            />
          </View>

          <Card style={styles.stats}>
            <Stat value={nearby.length} label="Nearby" />
            <View style={styles.statDivider} />
            <Stat value={online} label="Online" />
            <View style={styles.statDivider} />
            <Stat value={`${DEFAULT_SOS_RANGE_KM} km`} label="Radius" />
          </Card>

          <View style={styles.sosBlock}>
            <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />
            <Pressable
              onPress={() => router.push('/sos-trigger')}
              accessibilityRole="button"
              accessibilityLabel="Send an emergency SOS"
              accessibilityHint={`Alerts everyone within ${DEFAULT_SOS_RANGE_KM} kilometres`}
              style={({ pressed }) => [styles.sosPress, pressed && { transform: [{ scale: 0.97 }] }]}
            >
              <LinearGradient
                colors={[Colors.danger, Colors.dangerDeep]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.sosButton}
              >
                <Ionicons name="warning" size={26} color={Colors.onColor} />
                <Text style={styles.sosLabel}>SOS</Text>
              </LinearGradient>
            </Pressable>
            <Text style={styles.sosHint}>Tap, then hold to confirm</Text>
          </View>

          <SafetyTimer onFired={catchUp} />

          {location && <NearestHelp location={location} compact />}

          <View style={[styles.sectionHead, styles.afterTimer]}>
            <Overline>Responders nearby</Overline>
            <Text style={styles.sectionCount}>{nearby.length}</Text>
          </View>

          {nearby.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="Nobody in range yet"
              body={located
                ? 'People appear here as they come online around you.'
                : 'Waiting for your location to find people around you.'}
            />
          ) : (
            nearby.slice(0, 8).map((person) => (
              <Card key={person.id} style={styles.person}>
                <Avatar name={person.name} size={40} />
                <View style={styles.personText}>
                  <Text style={styles.personName} numberOfLines={1}>{person.name}</Text>
                  <Text style={styles.personMeta}>{formatKm(person.distance)} away</Text>
                </View>
                <Pill label="Ready" tone="safe" icon="checkmark-circle" />
              </Card>
            ))
          )}
        </ScrollView>

        {alert && (
          <Animated.View
            style={[styles.sheet, { transform: [{ translateY: sheetY }] }]}
            accessibilityViewIsModal
            accessibilityLiveRegion="assertive"
          >
            <View style={styles.sheetHead}>
              <View style={styles.sheetTitleWrap}>
                <Overline style={{ color: Colors.danger }}>Someone needs help</Overline>
                <Text style={styles.sheetName} numberOfLines={1}>
                  {alert.victim?.name} · {formatKm(alert.distance)}
                </Text>
              </View>
              <Pressable
                onPress={dismissAlert}
                accessibilityRole="button"
                accessibilityLabel="Dismiss alert"
                hitSlop={12}
                style={styles.sheetClose}
              >
                <Ionicons name="close" size={18} color={Colors.muted} />
              </Pressable>
            </View>

            <Text style={styles.sheetMessage}>{alert.message}</Text>

            <Photo
              source={getSOSImageSource(alert)}
              height={150}
              caption={`From ${alert.victim?.name ?? 'the scene'}`}
              accessibilityLabel="Photo shared by the person asking for help"
            />

            <Button label="I'm on my way" icon="navigate" onPress={respond} tone="danger" />
          </Animated.View>
        )}
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: Space.xl, paddingTop: Space.md, paddingBottom: Space.xxl },

  header: { flexDirection: 'row', alignItems: 'center', gap: Space.lg, marginBottom: Space.xl },
  headerText: { flex: 1 },
  greeting: { ...Type.caption, color: Colors.muted },
  name: { ...Type.title, color: Colors.text },

  statusRow: { flexDirection: 'row', gap: Space.sm, marginBottom: Space.lg },

  stats: { flexDirection: 'row', padding: 0, marginBottom: Space.xxl },
  statDivider: { width: 1, backgroundColor: Colors.divider, marginVertical: Space.lg },

  sosBlock: { alignItems: 'center', marginBottom: Space.xxl },
  halo: {
    position: 'absolute', top: 0, width: 168, height: 168, borderRadius: 84,
    backgroundColor: Colors.danger,
  },
  sosPress: { borderRadius: 84 },
  sosButton: {
    width: 168, height: 168, borderRadius: 84,
    alignItems: 'center', justifyContent: 'center', gap: Space.xs,
  },
  sosLabel: { fontFamily: Type.display.fontFamily, fontSize: 30, color: Colors.onColor, letterSpacing: 5 },
  sosHint: { ...Type.caption, color: Colors.subtle, marginTop: Space.lg },

  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: Space.md,
  },
  sectionCount: { ...Type.label, color: Colors.subtle },
  afterTimer: { marginTop: Space.xl },

  person: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md, marginBottom: Space.sm },
  personText: { flex: 1 },
  personName: { ...Type.bodyStrong, color: Colors.text },
  personMeta: { ...Type.caption, color: Colors.muted },

  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    borderTopWidth: 2, borderTopColor: Colors.danger,
    padding: Space.xl, paddingBottom: Space.xxl, gap: Space.md,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24,
    shadowOffset: { width: 0, height: -8 }, elevation: 24,
    zIndex: 100,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  sheetTitleWrap: { flex: 1, gap: 3 },
  sheetName: { ...Type.heading, color: Colors.text },
  sheetClose: {
    width: HIT - 8, height: HIT - 8, borderRadius: (HIT - 8) / 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated,
  },
  sheetMessage: { ...Type.body, color: Colors.muted },
});
