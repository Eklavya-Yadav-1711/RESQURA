import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Alert, Linking, Platform, AppState,
  BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  respondToSOS, markArrived, withdrawFromSOS, sendResponderLocation, getSocket,
  getCachedSOSAlert, getSOSDetails, getSOSImageSource, DEFAULT_SOS_MESSAGE,
} from '../services/api';
import { formatKm } from '../services/format';
import LiveMap from '../components/LiveMap';
import { Button, Card, Overline, Screen } from '../components/ui';
import Photo from '../components/Photo';
import { Colors, Space, Type } from '../theme';

export default function ResponderNav() {
  const router = useRouter();
  const { sosId, victimLat, victimLon, victimName } = useLocalSearchParams();
  const cached = getCachedSOSAlert(sosId);

  const [victim, setVictim] = useState({
    name: victimName || cached?.victim?.name || 'Someone nearby',
    lat: Number(victimLat) || cached?.location?.lat || null,
    lon: Number(victimLon) || cached?.location?.lon || null,
  });
  const [message, setMessage] = useState(cached?.message || DEFAULT_SOS_MESSAGE);
  const [photo, setPhoto] = useState(getSOSImageSource(cached));
  const [me, setMe] = useState(null);
  const [distance, setDistance] = useState(null);
  const [arriving, setArriving] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const watcher = useRef(null);
  const victimRef = useRef({ lat: Number(victimLat), lon: Number(victimLon) });

  useEffect(() => {
    const socket = getSocket();
    socket?.on('victim_location_update', onVictimMoved);
    socket?.on('sos_image', onPhoto);
    socket?.on('sos_ended', onEnded);
    socket?.on('connect', loadDetails);

    // Events that arrived while this phone was asleep are lost — including
    // "the emergency is over". Re-check on every return to the foreground.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') loadDetails();
    });

    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmLeave();
      return true;
    });

    start();

    return () => {
      watcher.current?.remove();
      appState.remove();
      back.remove();
      socket?.off('victim_location_update', onVictimMoved);
      socket?.off('sos_image', onPhoto);
      socket?.off('sos_ended', onEnded);
      socket?.off('connect', loadDetails);
    };
  }, []);

  function onVictimMoved(data) {
    if (String(data.sosId) !== String(sosId)) return;
    victimRef.current = { lat: data.lat, lon: data.lon };
    setVictim((v) => ({ ...v, lat: data.lat, lon: data.lon }));
  }

  function onPhoto(data) {
    if (String(data.sosId) === String(sosId)) setPhoto(getSOSImageSource(data));
  }

  function onEnded(data) {
    if (String(data.sosId) !== String(sosId)) return;
    router.replace({ pathname: '/sos-ended', params: { role: 'responder', resolved: '1' } });
  }

  async function start() {
    try {
      await respondToSOS(sosId);
    } catch (err) {
      Alert.alert('Could not join', err.message);
    }

    loadDetails();

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      watcher.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 4000 },
        ({ coords }) => {
          const point = { lat: coords.latitude, lon: coords.longitude };
          setMe(point);
          sendResponderLocation(sosId, point.lat, point.lon);
          const target = victimRef.current;
          if (Number.isFinite(target?.lat)) {
            setDistance(haversine(point.lat, point.lon, target.lat, target.lon));
          }
        }
      );
    } catch {}
  }

  /** The server is the source of truth — the in-memory alert may be gone. */
  async function loadDetails() {
    try {
      const data = await getSOSDetails(sosId);
      const { sos } = data;

      // It ended while we were away — do not keep navigating to someone safe.
      if (sos.status !== 'active') {
        router.replace({ pathname: '/sos-ended', params: { role: 'responder', resolved: '1' } });
        return;
      }

      setMessage(sos.message || DEFAULT_SOS_MESSAGE);
      setPhoto(getSOSImageSource(sos) || null);
      if (Number.isFinite(sos.location?.lat)) {
        victimRef.current = sos.location;
        setVictim({
          name: data.victim?.name || victimName || 'Someone nearby',
          lat: sos.location.lat,
          lon: sos.location.lon,
        });
      }
    } catch {}
  }

  function openDirections() {
    const { lat, lon } = victimRef.current;
    if (!Number.isFinite(lat)) return;
    const url = Platform.select({
      ios: `maps://?daddr=${lat},${lon}&dirflg=w`,
      default: `geo:${lat},${lon}?q=${lat},${lon}(Emergency)`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(
        `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
      )
    );
  }

  function confirmLeave() {
    Alert.alert(
      "Tell them you're not coming?",
      `${victim.name} will stop counting on you, and everyone else stays alerted.`,
      [
        { text: 'Keep going', style: 'cancel' },
        { text: "I can't make it", style: 'destructive', onPress: leave },
      ]
    );
  }

  /** Leaving without telling the server left the victim seeing "On the way". */
  async function leave() {
    setLeaving(true);
    try {
      await withdrawFromSOS(sosId);
    } catch {
      // Going back matters more than the bookkeeping succeeding.
    } finally {
      router.replace('/(tabs)');
    }
  }

  async function confirmArrived() {
    setArriving(true);
    try {
      await markArrived(sosId);
      router.replace({ pathname: '/sos-ended', params: { role: 'responder' } });
    } catch (err) {
      setArriving(false);
      Alert.alert('Could not confirm', err.message);
    }
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.banner}>
          <Ionicons name="navigate" size={16} color={Colors.onColor} />
          <Text style={styles.bannerText}>
            {distance !== null
              ? `${formatKm(distance)} to ${victim.name}`
              : `Heading to ${victim.name}`}
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <LiveMap
            height={250}
            victim={Number.isFinite(victim.lat) ? { lat: victim.lat, lon: victim.lon, label: victim.name } : null}
            me={me ? { ...me, label: 'You' } : null}
            showRoute
          />

          <Card style={styles.details}>
            <Overline>Emergency details</Overline>

            <View style={styles.line}>
              <Ionicons name="chatbubble-ellipses" size={16} color={Colors.danger} />
              <Text style={styles.lineText}>“{message}”</Text>
            </View>

            <View style={styles.line}>
              <Ionicons name="location" size={16} color={Colors.danger} />
              <Text style={styles.lineText}>
                {Number.isFinite(victim.lat)
                  ? `${victim.lat.toFixed(5)}, ${victim.lon.toFixed(5)}`
                  : 'Waiting for location'}
              </Text>
            </View>

            <Photo
              source={photo}
              height={180}
              caption={`From ${victim.name}`}
              accessibilityLabel="Photo shared from the scene"
            />
          </Card>

          <Button
            label="Open directions"
            icon="map"
            variant="ghost"
            onPress={openDirections}
          />
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label="I've arrived"
            icon="checkmark-circle"
            tone="safe"
            onPress={confirmArrived}
            loading={arriving}
          />
          <Button
            label="I can't make it"
            variant="ghost"
            onPress={confirmLeave}
            loading={leaving}
          />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm,
    backgroundColor: Colors.safeDeep, paddingVertical: Space.md, paddingHorizontal: Space.lg,
  },
  bannerText: { ...Type.label, color: Colors.onColor },

  scroll: { padding: Space.xl, paddingBottom: Space.lg, gap: Space.lg },

  details: { gap: Space.md },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  lineText: { flex: 1, ...Type.body, color: Colors.muted },

  footer: {
    paddingHorizontal: Space.xl, paddingTop: Space.md, paddingBottom: Space.md, gap: Space.sm,
    borderTopWidth: 1, borderTopColor: Colors.divider, backgroundColor: Colors.bg,
  },
});
