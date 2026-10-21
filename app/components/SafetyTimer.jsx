import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getTimer, startTimer, checkInTimer, cancelTimer, extendTimer, expireTimer, getSocket,
} from '../services/api';
import { formatElapsed, parseServerDate } from '../services/format';
import { Button, Card, Overline } from './ui';
import { Colors, Space, Radius, Type } from '../theme';

const PRESETS = [10, 20, 30, 60];
const UNITS = [
  { key: 'seconds', label: 'sec', multiplier: 1 },
  { key: 'minutes', label: 'min', multiplier: 60 },
  { key: 'hours', label: 'hr', multiplier: 3600 },
];

/**
 * "Expect me in 20 minutes." The countdown here is only a display — the
 * deadline lives on the server, so the SOS still fires if this phone dies.
 */
export default function SafetyTimer({ onFired }) {
  const [timer, setTimer] = useState(null);
  const [remaining, setRemaining] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(20 * 60);
  const [customDuration, setCustomDuration] = useState('');
  const [unit, setUnit] = useState('minutes');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const tick = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getTimer();
      setTimer(data?.timer && typeof data.timer === 'object' ? data.timer : null);
    } catch {}
  }, []);

  useEffect(() => {
    load();

    const socket = getSocket();
    const onExpired = () => { load(); onFired?.(); };
    socket?.on('timer_expired', onExpired);
    socket?.on('timer_warning', load);

    return () => {
      clearInterval(tick.current);
      socket?.off('timer_expired', onExpired);
      socket?.off('timer_warning', load);
    };
  }, [load]);

  // Local countdown against the server's deadline.
  useEffect(() => {
    clearInterval(tick.current);
    if (timer?.status !== 'running') return undefined;

    const deadline = parseServerDate(timer.expiresAt);
    if (!deadline) return undefined;

    const update = () => {
      const left = Math.round((deadline.getTime() - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) {
        clearInterval(tick.current);
        expireTimer()
          .then((data) => {
            setTimer(data.timer);
            if (data.sosId) onFired?.(data.sosId);
          })
          .catch(() => load());
      }
    };
    update();
    tick.current = setInterval(update, 1000);
    return () => clearInterval(tick.current);
  }, [timer, load]);

  async function run(action, ...args) {
    setBusy(true);
    try {
      const data = await action(...args);
      setTimer(data.timer);
      return data;
    } catch (err) {
      Alert.alert('Safety timer', err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function begin() {
    const selectedUnit = UNITS.find((item) => item.key === unit);
    const typed = Number(customDuration);
    const seconds = customDuration.trim()
      ? Math.round(typed * (selectedUnit?.multiplier || 60))
      : durationSeconds;
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 86400) {
      Alert.alert('Safety timer', 'Enter a duration between 1 second and 24 hours.');
      return;
    }
    const data = await run(startTimer, seconds, note.trim() || null);
    if (data) {
      setOpen(false);
      setNote('');
      setCustomDuration('');
    }
  }

  function confirmCancel() {
    Alert.alert('Cancel the timer?', 'No SOS will be sent when it runs out.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel timer', style: 'destructive', onPress: () => run(cancelTimer) },
    ]);
  }

  const running = timer?.status === 'running';
  const urgent = running && remaining <= 120;

  if (running) {
    return (
      <Card style={styles.card} tone={urgent ? 'danger' : undefined}>
        <View style={styles.head}>
          <Overline style={urgent ? { color: Colors.danger } : undefined}>
            {urgent ? 'Check in now' : 'Getting home safe'}
          </Overline>
          <Text style={[styles.clock, urgent && { color: Colors.danger }]}>
            {formatElapsed(Math.max(0, remaining))}
          </Text>
        </View>

        <Text style={styles.blurb}>
          {timer.note ? `${timer.note}. ` : ''}
          If you do not check in, an SOS goes out with your location.
        </Text>

        <View style={styles.row}>
          <Button
            label="I'm safe"
            icon="checkmark-circle"
            tone="safe"
            onPress={() => run(checkInTimer)}
            disabled={busy}
            style={styles.grow}
          />
          <Button
            label="+10 min"
            variant="ghost"
            onPress={() => run(extendTimer, 10)}
            disabled={busy}
            style={styles.grow}
          />
        </View>

        <Pressable onPress={confirmCancel} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.cancel}>Cancel timer</Text>
        </Pressable>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Overline>Safety timer</Overline>
        <Ionicons name="timer-outline" size={16} color={Colors.subtle} />
      </View>

      {open ? (
        <>
          <Text style={styles.blurb}>How long until you are somewhere safe?</Text>

          <View style={styles.presets}>
            {PRESETS.map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setDurationSeconds(value * 60);
                  setCustomDuration('');
                  setUnit('minutes');
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: !customDuration && durationSeconds === value * 60 }}
                style={({ pressed }) => [
                  styles.preset,
                  !customDuration && durationSeconds === value * 60 && styles.presetOn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.presetText, !customDuration && durationSeconds === value * 60 && styles.presetTextOn]}>
                  {value} min
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            value={customDuration}
            onChangeText={setCustomDuration}
            placeholder="Custom duration"
            placeholderTextColor={Colors.subtle}
            keyboardType="decimal-pad"
            accessibilityLabel="Custom timer duration"
            style={styles.duration}
          />
          <View style={styles.units}>
            {UNITS.map((item) => (
              <Pressable
                key={item.key}
                onPress={() => setUnit(item.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: unit === item.key }}
                style={[styles.unit, unit === item.key && styles.unitOn]}
              >
                <Text style={[styles.presetText, unit === item.key && styles.presetTextOn]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Walking home from the library (optional)"
            placeholderTextColor={Colors.subtle}
            accessibilityLabel="What you are doing"
            style={styles.note}
            maxLength={120}
          />

          <View style={styles.row}>
            <Button label="Start" icon="play" onPress={begin} loading={busy} style={styles.grow} />
            <Button label="Close" variant="ghost" onPress={() => setOpen(false)} style={styles.grow} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.blurb}>
            Tell RESQORA when to expect you. Miss the check-in and it raises an
            SOS for you — even if your phone is gone.
          </Text>
          <Button label="Set a timer" icon="timer" variant="ghost" onPress={() => setOpen(true)} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clock: { ...Type.numeric, fontSize: 22, color: Colors.text },
  blurb: { ...Type.caption, color: Colors.muted },
  row: { flexDirection: 'row', gap: Space.md },
  grow: { flex: 1 },
  cancel: { ...Type.caption, color: Colors.subtle, textAlign: 'center', paddingVertical: Space.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  preset: {
    paddingHorizontal: Space.lg, paddingVertical: Space.md,
    borderRadius: Radius.pill, backgroundColor: Colors.elevated,
    borderWidth: 1, borderColor: Colors.border,
  },
  presetOn: { backgroundColor: Colors.dangerSoft, borderColor: Colors.danger },
  presetText: { ...Type.label, color: Colors.muted },
  presetTextOn: { color: Colors.danger },
  note: {
    ...Type.body, color: Colors.text, backgroundColor: Colors.elevated,
    borderRadius: Radius.md, paddingHorizontal: Space.lg, paddingVertical: Space.md,
    borderWidth: 1, borderColor: Colors.border, minHeight: 48,
  },
  duration: {
    ...Type.body, color: Colors.text, backgroundColor: Colors.elevated,
    borderRadius: Radius.md, paddingHorizontal: Space.lg, paddingVertical: Space.md,
    borderWidth: 1, borderColor: Colors.border, minHeight: 48,
  },
  units: { flexDirection: 'row', gap: Space.sm },
  unit: {
    paddingHorizontal: Space.lg, paddingVertical: Space.sm,
    borderRadius: Radius.pill, backgroundColor: Colors.elevated,
    borderWidth: 1, borderColor: Colors.border,
  },
  unitOn: { backgroundColor: Colors.dangerSoft, borderColor: Colors.danger },
});
