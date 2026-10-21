import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Animated, Alert, AppState, Pressable,
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getSocket, endSOS, sendLocationUpdate, getActiveSOS, attachSOSImage,
  getSOSImageSource, DEFAULT_SOS_MESSAGE,
} from '../services/api';
import { pickImage } from '../services/photo';
import { buildAlertText, textContacts, shareLink, copyLink } from '../services/share';
import { formatElapsed, formatKm, parseServerDate } from '../services/format';
import { getStoredUser } from '../services/api';
import LiveMap from '../components/LiveMap';
import { Avatar, Button, Card, EmptyState, Overline, Pill, Screen, Stat } from '../components/ui';
import Photo from '../components/Photo';
import NearestHelp from '../components/NearestHelp';
import SOSChat from '../components/SOSChat';
import { Colors, Space, Type } from '../theme';

/** Only this re-renders each second — not the map and every card around it. */
function ElapsedStat({ since }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [since]);

  return <Stat value={formatElapsed(seconds)} label="Elapsed" />;
}

const STATUS = {
  arrived: { label: 'Arrived', tone: 'safe', icon: 'checkmark-circle' },
  responding: { label: 'On the way', tone: 'warn', icon: 'walk' },
  alerted: { label: 'Alerted', tone: 'neutral', icon: 'notifications' },
};

export default function SOSActive() {
  const router = useRouter();
  const { sosId, alertedCount, startedAt: startedAtParam } = useLocalSearchParams();
  const startedAtValue = Array.isArray(startedAtParam) ? startedAtParam[0] : startedAtParam;
  const initialStartedAt = parseServerDate(startedAtValue)?.getTime();
  const [startedAt, setStartedAt] = useState(() => initialStartedAt || Date.now());
  const [responders, setResponders] = useState([]);
  const [here, setHere] = useState(null);
  const [message, setMessage] = useState(DEFAULT_SOS_MESSAGE);
  const [photo, setPhoto] = useState(null);
  const [alerted, setAlerted] = useState(Number(alertedCount) || 0);
  const [uploading, setUploading] = useState(false);
  const [ending, setEnding] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [texting, setTexting] = useState(false);

  const [user, setUser] = useState(null);
  const blink = useRef(new Animated.Value(1)).current;
  const watcher = useRef(null);
  const endedRef = useRef(false);
  const restoringRef = useRef(false);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    const socket = getSocket();
    socket?.on('responder_coming', onComing);
    socket?.on('responder_arrived', onArrived);
    socket?.on('responder_location', onResponderMoved);
    socket?.on('responder_left', onLeft);
    // A backgrounded phone suspends its socket, so events sent meanwhile are
    // gone for good. Re-read the truth whenever we come back.
    socket?.on('connect', restore);

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') restore();
    });
    const responderCheck = setInterval(restore, 10000);

    // Back is one tap away from stranding you outside your own emergency.
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      Alert.alert(
        'Your SOS is still live',
        'People are being shown your location right now.',
        [
          { text: 'Stay here', style: 'cancel' },
          { text: "I'm safe — end it", style: 'destructive', onPress: finish },
        ]
      );
      return true;
    });

    getStoredUser().then(setUser).catch(() => {});
    restore();
    trackSelf();

    return () => {
      watcher.current?.remove();
      appState.remove();
      clearInterval(responderCheck);
      back.remove();
      socket?.off('responder_coming', onComing);
      socket?.off('responder_arrived', onArrived);
      socket?.off('responder_location', onResponderMoved);
      socket?.off('responder_left', onLeft);
      socket?.off('connect', restore);
    };
  }, []);

  function onComing({ responder, distance }) {
    setResponders((prev) => {
      const known = prev.find((r) => r.id === responder.id);
      if (known) return prev.map((r) => (r.id === responder.id ? { ...r, status: 'responding' } : r));
      return [...prev, { ...responder, status: 'responding', distance }];
    });
  }

  function onArrived({ responder }) {
    setResponders((prev) =>
      prev.map((r) => (r.id === responder.id ? { ...r, status: 'arrived' } : r)));
  }

  function onLeft({ responder }) {
    setResponders((prev) =>
      prev.map((r) => (r.id === responder.id ? { ...r, status: 'declined' } : r)));
  }

  function onResponderMoved({ responderId, lat, lon, distance }) {
    setResponders((prev) =>
      prev.map((r) => (r.id === responderId ? { ...r, lat, lon, distance } : r)));
  }

  /** Re-reads the emergency from the server: statuses, photo, responders. */
  async function restore() {
    if (restoringRef.current) return;
    restoringRef.current = true;
    try {
      const data = await getActiveSOS();

      // Ended elsewhere (another device, or the server's stale-SOS sweep):
      // do not leave the victim staring at a live screen that is not live.
      if (!data.active) {
        if (!endedRef.current) {
          endedRef.current = true;
          router.replace({ pathname: '/sos-ended', params: { role: 'victim' } });
        }
        return;
      }

      const sos = data.sos;
      setMessage((current) => current === (sos.message || DEFAULT_SOS_MESSAGE)
        ? current : (sos.message || DEFAULT_SOS_MESSAGE));
      const nextPhoto = getSOSImageSource(sos);
      setPhoto((current) => current?.uri === nextPhoto?.uri ? current : nextPhoto);
      setShareUrl((current) => current === (data.shareUrl || null) ? current : (data.shareUrl || null));
      setContacts((current) => sameList(current, data.contacts) ? current : (data.contacts || []));
      setHere((current) => current || sos.location);

      // Server statuses win, but keep the live distance a socket already gave us.
      const serverResponders = Array.isArray(data.responders) ? data.responders : [];
      setResponders((prev) => {
        const next = serverResponders.map((r) => {
        const known = prev.find((p) => p.id === r.id);
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          lat: r.latitude || known?.lat,
          lon: r.longitude || known?.lon,
          distance: Number.isFinite(Number(r.distance)) ? Number(r.distance) : known?.distance,
        };
        });
        return sameResponders(prev, next) ? prev : next;
      });
      setAlerted((count) => count || serverResponders.length);

      const started = parseServerDate(sos.started_at);
      if (started) {
        const nextStartedAt = started.getTime();
        setStartedAt((current) => current === nextStartedAt ? current : nextStartedAt);
      }
    } catch {} finally {
      restoringRef.current = false;
    }
  }

  function sameList(left, right) {
    const next = Array.isArray(right) ? right : [];
    return Array.isArray(left) && left.length === next.length
      && left.every((item, index) => item?.id === next[index]?.id);
  }

  function sameResponders(left, right) {
    return left.length === right.length && left.every((item, index) => {
      const next = right[index];
      return item.id === next.id
        && item.name === next.name
        && item.status === next.status
        && item.lat === next.lat
        && item.lon === next.lon;
    });
  }

  async function trackSelf() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 10, timeInterval: 5000 },
        ({ coords }) => {
          setHere({ lat: coords.latitude, lon: coords.longitude });
          sendLocationUpdate(coords.latitude, coords.longitude);
        }
      );
    } catch {}
  }

  async function addPhoto() {
    if (uploading) return;
    try {
      const picked = await pickImage();
      if (!picked) return;
      setUploading(true);
      const data = await attachSOSImage(sosId, picked);
      setPhoto(getSOSImageSource(data));
    } catch (err) {
      Alert.alert('Photo not sent', err.message);
    } finally {
      setUploading(false);
    }
  }

  /** Reaches people who are not on RESQORA at all. */
  async function notifyContacts() {
    setTexting(true);
    try {
      await textContacts(contacts, buildAlertText(user?.name, message, shareUrl));
    } catch (err) {
      Alert.alert('Could not open messages', err.message);
    } finally {
      setTexting(false);
    }
  }

  async function shareAnywhere() {
    try {
      await shareLink(buildAlertText(user?.name, message, shareUrl));
    } catch {}
  }

  function confirmEnd() {
    Alert.alert('End this SOS?', 'Everyone coming to help will be told you are safe.', [
      { text: 'Keep it active', style: 'cancel' },
      { text: 'I am safe', style: 'destructive', onPress: finish },
    ]);
  }

  async function finish() {
    setEnding(true);
    endedRef.current = true;
    try {
      await endSOS(sosId);
      router.replace({ pathname: '/sos-ended', params: { role: 'victim' } });
    } catch (err) {
      setEnding(false);
      Alert.alert('Could not end the SOS', err.message);
    }
  }

  // Only people actually on their way or already there.
  const coming = responders.filter((r) => r.status === 'responding' || r.status === 'arrived');

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Animated.View style={[styles.banner, { opacity: blink }]}>
          <Ionicons name="radio" size={16} color={Colors.onColor} />
          <Text style={styles.bannerText}>SOS live — your location is being shared</Text>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <LiveMap
            height={230}
            victim={here ? { ...here, label: 'You' } : null}
            responders={coming.map((r) => ({ id: r.id, lat: r.lat, lon: r.lon, label: r.name }))}
          />

          <Card style={styles.stats}>
            <ElapsedStat since={startedAt} />
            <View style={styles.divider} />
            <Stat value={alerted} label="Alerted" />
            <View style={styles.divider} />
            <Stat value={coming.length} label="Coming" tone="safe" />
          </Card>

          <Card style={styles.shared}>
            <Overline>Shared with them</Overline>
            <Text style={styles.message}>“{message}”</Text>
            <Photo
              source={photo}
              height={160}
              caption="Shared with everyone responding"
              accessibilityLabel="Photo you shared with responders"
            />
            <Button
              label={uploading ? 'Sending…' : photo ? 'Replace photo' : 'Add a photo'}
              icon="camera"
              variant="ghost"
              onPress={addPhoto}
              disabled={uploading}
            />
          </Card>

          {shareUrl && (
            <Card style={styles.share}>
              <Overline>Tell people who are not on RESQORA</Overline>
              <Text style={styles.shareBlurb}>
                Anyone with this link watches your location move on a map, in any browser.
              </Text>
              <Pressable onPress={() => copyLink(shareUrl)} accessibilityRole="button">
                <Text style={styles.link} numberOfLines={1}>{shareUrl}</Text>
              </Pressable>
              <View style={styles.shareActions}>
                <Button
                  label={contacts.length ? `Text my ${contacts.length}` : 'No contacts yet'}
                  icon="chatbubble"
                  variant="ghost"
                  onPress={notifyContacts}
                  disabled={!contacts.length || texting}
                  style={styles.grow}
                />
                <Button
                  label="Share"
                  icon="share-social"
                  variant="ghost"
                  onPress={shareAnywhere}
                  style={styles.grow}
                />
              </View>
            </Card>
          )}

          <NearestHelp location={here} />

          <Overline style={styles.sectionLabel}>People responding</Overline>

          {coming.length === 0 ? (
            <EmptyState
              icon="hourglass-outline"
              title="Waiting for someone to accept"
              body={`${alerted || 'Nearby'} people have been alerted.`}
            />
          ) : (
            coming.map((r) => {
              const status = STATUS[r.status] || STATUS.alerted;
              return (
                <Card key={r.id} style={styles.person}>
                  <Avatar name={r.name} size={40} />
                  <View style={styles.personText}>
                    <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.personMeta}>
                      {Number.isFinite(r.distance) ? `${formatKm(r.distance)} away` : 'Location pending'}
                    </Text>
                  </View>
                  <Pill label={status.label} tone={status.tone} icon={status.icon} />
                </Card>
              );
            })
          )}

          <SOSChat sosId={sosId} userId={user?.id} />
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="I'm safe — end SOS"
            icon="checkmark-circle"
            tone="safe"
            onPress={confirmEnd}
            loading={ending}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm,
    backgroundColor: Colors.dangerDeep, paddingVertical: Space.md, paddingHorizontal: Space.lg,
  },
  bannerText: { ...Type.label, color: Colors.onColor },

  scroll: { padding: Space.xl, paddingBottom: Space.lg, gap: Space.lg },

  stats: { flexDirection: 'row', padding: 0 },
  divider: { width: 1, backgroundColor: Colors.divider, marginVertical: Space.lg },

  shared: { gap: Space.md },
  message: { ...Type.body, color: Colors.text },

  sectionLabel: { marginTop: Space.xs },

  share: { gap: Space.md },
  shareBlurb: { ...Type.caption, color: Colors.muted },
  link: {
    ...Type.caption, color: Colors.info, backgroundColor: Colors.elevated,
    paddingHorizontal: Space.md, paddingVertical: Space.md, borderRadius: 10,
  },
  shareActions: { flexDirection: 'row', gap: Space.md },
  grow: { flex: 1 },

  person: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md },
  personText: { flex: 1 },
  personName: { ...Type.bodyStrong, color: Colors.text },
  personMeta: { ...Type.caption, color: Colors.muted },

  footer: {
    paddingHorizontal: Space.xl, paddingTop: Space.md, paddingBottom: Space.md,
    borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.bg,
  },
});
