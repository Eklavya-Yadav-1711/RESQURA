import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, ScrollView, Image, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  triggerSOS, clearMyActiveSOS, DEFAULT_SOS_MESSAGE, DEFAULT_SOS_RANGE_KM,
} from '../services/api';
import { pickImage } from '../services/photo';
import { Button, Card, Overline, Screen } from '../components/ui';
import { Colors, Space, Radius, Type, Motion } from '../theme';

const HOLD_MS = 3000;
const COUNTDOWN_S = 5;

/**
 * One screen, three states: hold to arm, countdown to cancel, sending.
 * Both safety gates live here so an emergency never costs an extra navigation.
 */
export default function SOSTrigger() {
  const router = useRouter();
  const [stage, setStage] = useState('idle');
  const [seconds, setSeconds] = useState(COUNTDOWN_S);
  const [photo, setPhoto] = useState(null);
  const [busyPhoto, setBusyPhoto] = useState(false);

  const hold = useRef(new Animated.Value(0)).current;
  const holdAnim = useRef(null);
  const ticker = useRef(null);
  const photoRef = useRef(null);
  const sentRef = useRef(false);
  const stageRef = useRef('idle');

  useEffect(() => () => {
    holdAnim.current?.stop();
    clearInterval(ticker.current);
  }, []);

  function goTo(next) {
    stageRef.current = next;
    setStage(next);
  }

  function startHold() {
    if (stageRef.current !== 'idle') return;
    hold.setValue(0);
    holdAnim.current = Animated.timing(hold, {
      toValue: 1, duration: HOLD_MS, useNativeDriver: false,
    });
    holdAnim.current.start(({ finished }) => {
      if (finished && stageRef.current === 'idle') beginCountdown();
    });
  }

  function cancelHold() {
    holdAnim.current?.stop();
    if (stageRef.current === 'idle') {
      Animated.timing(hold, { toValue: 0, duration: Motion.base, useNativeDriver: false }).start();
    }
  }

  function beginCountdown() {
    goTo('countdown');
    setSeconds(COUNTDOWN_S);
    runTicker();
  }

  function runTicker() {
    clearInterval(ticker.current);
    ticker.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(ticker.current);
          send();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function attachPhoto() {
    if (busyPhoto || stageRef.current === 'sending') return;
    clearInterval(ticker.current);
    setBusyPhoto(true);
    try {
      const picked = await pickImage();
      if (picked) {
        photoRef.current = picked;
        setPhoto(picked);
      }
    } catch (err) {
      Alert.alert('Photo not attached', err.message);
    } finally {
      setBusyPhoto(false);
      if (stageRef.current === 'countdown' && !sentRef.current) runTicker();
    }
  }

  function removePhoto() {
    photoRef.current = null;
    setPhoto(null);
  }

  async function send() {
    if (sentRef.current) return;
    sentRef.current = true;
    clearInterval(ticker.current);
    goTo('sending');

    try {
      const { coords } = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const result = await triggerSOS(
        coords.latitude,
        coords.longitude,
        DEFAULT_SOS_MESSAGE,
        DEFAULT_SOS_RANGE_KM,
        photoRef.current
      );
      router.replace({
        pathname: '/sos-active',
        params: { sosId: String(result.sosId), alertedCount: String(result.alertedCount) },
      });
    } catch (err) {
      sentRef.current = false;
      goTo('countdown');

      // The server says one is already running: take them to it, or close it.
      const running = err.data?.sos;
      if (running?.id) {
        Alert.alert(
          'You already have an SOS running',
          'Open it to see who is coming, or close it and start a new one.',
          [
            {
              text: 'Open it',
              onPress: () => router.replace({
                pathname: '/sos-active',
                params: { sosId: String(running.id) },
              }),
            },
            {
              text: 'Close and resend',
              style: 'destructive',
              onPress: async () => {
                try {
                  await clearMyActiveSOS();
                  send();
                } catch (e) {
                  Alert.alert('Could not clear it', e.message);
                }
              },
            },
            { text: 'Cancel', style: 'cancel', onPress: cancelAll },
          ]
        );
        return;
      }

      Alert.alert('SOS not sent', err.message, [
        { text: 'Try again', onPress: send },
        { text: 'Cancel', style: 'cancel', onPress: cancelAll },
      ]);
    }
  }

  function cancelAll() {
    sentRef.current = true;
    clearInterval(ticker.current);
    holdAnim.current?.stop();
    router.back();
  }

  const progress = hold.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  const counting = stage === 'countdown';
  const sending = stage === 'sending';

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.head}>
            <Overline style={{ color: counting ? Colors.danger : Colors.subtle }}>
              {counting ? 'Sending your alert' : 'Emergency SOS'}
            </Overline>
            <Text style={styles.headline}>
              {sending
                ? 'Sending…'
                : counting
                  ? (seconds > 0 ? `Going out in ${seconds}s` : 'Ready to send')
                  : 'Hold the button to call for help'}
            </Text>
          </View>

          <View style={styles.dialWrap}>
            <Pressable
              onPressIn={startHold}
              onPressOut={cancelHold}
              disabled={stage !== 'idle'}
              accessibilityRole="button"
              accessibilityLabel="Hold for three seconds to send an SOS"
              style={({ pressed }) => [styles.dialPress, pressed && { transform: [{ scale: 0.97 }] }]}
            >
              <LinearGradient
                colors={counting || sending
                  ? [Colors.dangerDeep, '#7F1D1D']
                  : [Colors.danger, Colors.dangerDeep]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.dial}
              >
                {counting && seconds > 0 ? (
                  <Text style={styles.count}>{seconds}</Text>
                ) : sending ? (
                  <Ionicons name="paper-plane" size={44} color={Colors.onColor} />
                ) : (
                  <>
                    <Ionicons name="finger-print" size={34} color={Colors.onColor} />
                    <Text style={styles.dialLabel}>HOLD</Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>

            {stage === 'idle' && (
              <View style={styles.track}>
                <Animated.View style={[styles.trackFill, { width: progress }]} />
              </View>
            )}
          </View>

          <Card style={styles.payload}>
            <Overline>What everyone nearby receives</Overline>

            <View style={styles.line}>
              <Ionicons name="location" size={16} color={Colors.danger} />
              <Text style={styles.lineText}>
                Your live location, updated until you end the SOS
              </Text>
            </View>

            <View style={styles.line}>
              <Ionicons name="chatbubble-ellipses" size={16} color={Colors.danger} />
              <Text style={styles.lineText}>“{DEFAULT_SOS_MESSAGE}”</Text>
            </View>

            <View style={styles.line}>
              <Ionicons name="people" size={16} color={Colors.danger} />
              <Text style={styles.lineText}>Everyone within {DEFAULT_SOS_RANGE_KM} km</Text>
            </View>

            {photo ? (
              <View style={styles.photoRow}>
                <Image source={{ uri: photo.uri }} style={styles.photo} />
                <View style={styles.photoText}>
                  <Text style={styles.photoTitle}>Photo attached</Text>
                  <Pressable onPress={removePhoto} hitSlop={10} accessibilityRole="button">
                    <Text style={styles.photoRemove}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            <Button
              label={busyPhoto ? 'Opening…' : photo ? 'Change photo' : 'Add a photo'}
              icon="camera"
              variant="ghost"
              onPress={attachPhoto}
              disabled={busyPhoto || sending}
              style={styles.photoBtn}
            />
          </Card>

          <View style={styles.actions}>
            {counting && (
              <Button label="Send now" icon="alert-circle" onPress={send} />
            )}
            <Button
              label={counting ? 'Cancel — false alarm' : 'Go back'}
              variant={counting ? 'outline' : 'ghost'}
              tone="danger"
              onPress={cancelAll}
              disabled={sending}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: Space.xl, paddingBottom: Space.xxl },

  head: { alignItems: 'center', gap: Space.sm, marginBottom: Space.xl },
  headline: { ...Type.title, color: Colors.text, textAlign: 'center' },

  dialWrap: { alignItems: 'center', marginBottom: Space.xxl },
  dialPress: { borderRadius: 96 },
  dial: {
    width: 192, height: 192, borderRadius: 96,
    alignItems: 'center', justifyContent: 'center', gap: Space.xs,
  },
  dialLabel: { ...Type.overline, color: Colors.onColor, letterSpacing: 3 },
  count: { fontFamily: Type.display.fontFamily, fontSize: 68, color: Colors.onColor, fontVariant: ['tabular-nums'] },
  track: {
    width: 192, height: 4, borderRadius: 2, marginTop: Space.lg,
    backgroundColor: Colors.elevated, overflow: 'hidden',
  },
  trackFill: { height: '100%', backgroundColor: Colors.danger },

  payload: { gap: Space.md, marginBottom: Space.xl },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.md },
  lineText: { flex: 1, ...Type.body, color: Colors.muted },

  photoRow: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    borderTopWidth: 1, borderTopColor: Colors.divider, paddingTop: Space.md,
  },
  photo: { width: 56, height: 56, borderRadius: Radius.sm, backgroundColor: Colors.elevated },
  photoText: { flex: 1, gap: 2 },
  photoTitle: { ...Type.bodyStrong, color: Colors.text },
  photoRemove: { ...Type.caption, color: Colors.danger },
  photoBtn: { marginTop: Space.xs },

  actions: { gap: Space.md },
});
