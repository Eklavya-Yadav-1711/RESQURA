import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, StyleSheet, Text, Vibration, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import {
  cacheSOSAlert, connectSocket, getIncomingSOS, getStoredUser, getSOSImageSource,
} from '../services/api';
import { formatKm } from '../services/format';
import { Button, Card, Overline } from './ui';
import Photo from './Photo';
import { Colors, Space, Type } from '../theme';

function normalize(data) {
  const location = data?.location || {
    lat: Number(data?.victim_lat),
    lon: Number(data?.victim_lon),
  };
  const lat = Number(location?.lat);
  const lon = Number(location?.lon);
  if (!data || !data.id && !data.sosId || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    ...data,
    sosId: data.sosId || data.id,
    victim: data.victim || { id: data.victim_id, name: data.victim_name || 'Someone nearby' },
    message: data.message || 'Someone nearby needs help.',
    location: { lat, lon },
    distance: Number.isFinite(Number(data.distance)) ? Number(data.distance) : null,
  };
}

export default function InAppAlertOverlay() {
  const router = useRouter();
  const segments = useSegments();
  const [alert, setAlert] = useState(null);
  const [dismissed, setDismissed] = useState(null);
  const y = useRef(new Animated.Value(400)).current;
  const current = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let socket;

    async function start() {
      const user = await getStoredUser();
      if (cancelled || !user) return;
      socket = connectSocket(user.id);
      socket.on('sos_alert', show);
      poll();
    }

    async function poll() {
      try {
        const data = await getIncomingSOS();
        const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
        const next = alerts.map(normalize).find((item) =>
          item && String(item.sosId) !== String(dismissed)
        );
        if (next) show(next);
      } catch {}
    }

    const timer = setInterval(poll, 3000);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll();
    });
    start();

    return () => {
      cancelled = true;
      clearInterval(timer);
      appState.remove();
      if (socket) socket.off('sos_alert', show);
    };

    function show(data) {
      const next = normalize(data);
      if (!next || String(next.sosId) === String(current.current)) return;
      cacheSOSAlert(next);
      current.current = next.sosId;
      setAlert(next);
      Vibration.vibrate([0, 400, 180, 400, 180, 400]);
    }
  }, [dismissed]);

  useEffect(() => {
    if (!alert) return undefined;
    y.setValue(400);
    const animation = Animated.spring(y, {
      toValue: 0, useNativeDriver: true, tension: 60, friction: 11,
    });
    animation.start();
    return () => animation.stop();
  }, [alert, y]);

  if (!alert || segments[segments.length - 1] === 'index') return null;

  function dismiss() {
    setDismissed(alert.sosId);
    current.current = null;
    Animated.timing(y, { toValue: 400, duration: 180, useNativeDriver: true }).start(() => setAlert(null));
  }

  function respond() {
    const next = alert;
    dismiss();
    router.push({
      pathname: '/responder-nav',
      params: {
        sosId: String(next.sosId),
        victimLat: String(next.location.lat),
        victimLon: String(next.location.lon),
        victimName: next.victim?.name || '',
      },
    });
  }

  return (
    <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
      <Card style={styles.card} tone="danger">
        <Overline style={styles.overline}>Someone needs help</Overline>
        <Text style={styles.title} numberOfLines={1}>
          {alert.victim?.name} · {formatKm(alert.distance)}
        </Text>
        <Text style={styles.message}>{alert.message}</Text>
        <Photo source={getSOSImageSource(alert)} height={100} caption="Emergency alert" />
        <View style={styles.actions}>
          <Button label="I'm on my way" icon="navigate" onPress={respond} />
          <Button label="Dismiss" variant="ghost" onPress={dismiss} />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000,
    padding: Space.lg, backgroundColor: Colors.bg,
  },
  card: { gap: Space.sm },
  overline: { color: Colors.danger },
  title: { ...Type.heading, color: Colors.text },
  message: { ...Type.body, color: Colors.muted },
  actions: { gap: Space.sm },
});
