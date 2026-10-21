import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { subscribeConnection, recheckConnection } from '../services/connection';
import { Colors, Space, Radius, Type } from '../theme';

/**
 * A safety app that cannot reach its server has to say so — otherwise the
 * failure is invisible: buttons appear to work and lists are simply empty, so
 * it reads as "nobody is nearby" rather than "nothing is connected".
 *
 * The check itself is shared (services/connection.js): one timer for the whole
 * app, and two consecutive failures before it appears, so it cannot flicker.
 */
export default function ConnectionBanner() {
  const [{ online, checking }, setState] = useState({ online: true, checking: false });

  useEffect(() => subscribeConnection(setState), []);

  if (online) return null;

  return (
    <View style={styles.bar} accessibilityLiveRegion="polite">
      <Ionicons name="cloud-offline" size={16} color={Colors.onColor} />
      <View style={styles.text}>
        <Text style={styles.title}>Can't reach the RESQORA server</Text>
        <Text style={styles.sub}>Alerts will not send or arrive right now</Text>
      </View>
      <Pressable
        onPress={recheckConnection}
        disabled={checking}
        accessibilityRole="button"
        accessibilityLabel="Retry the connection"
        hitSlop={10}
        style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.retryText}>{checking ? 'Checking…' : 'Retry'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    backgroundColor: Colors.dangerDeep,
    paddingHorizontal: Space.lg, paddingVertical: Space.md,
  },
  text: { flex: 1 },
  title: { ...Type.label, color: Colors.onColor },
  sub: { ...Type.caption, color: 'rgba(255,255,255,0.75)', fontSize: 11 },
  retry: {
    paddingHorizontal: Space.md, paddingVertical: 6,
    borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.18)',
  },
  retryText: { ...Type.label, color: Colors.onColor },
});
