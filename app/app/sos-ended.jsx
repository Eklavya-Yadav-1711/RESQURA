import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Overline, Screen } from '../components/ui';
import { Colors, Space, Type } from '../theme';

const COPY = {
  victim: {
    title: 'You marked yourself safe',
    body: 'Everyone who was coming to help has been told the emergency is over.',
  },
  responder: {
    title: 'Thank you for going',
    body: 'The person who called for help knows you arrived.',
  },
  resolved: {
    title: 'The emergency has ended',
    body: 'The person who called for help says they are safe now.',
  },
};

export default function SOSEnded() {
  const router = useRouter();
  const { role, resolved } = useLocalSearchParams();
  const copy = resolved === '1' ? COPY.resolved : COPY[role] || COPY.victim;

  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, tension: 60, friction: 6, useNativeDriver: true }).start();
  }, []);

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Animated.View style={{ transform: [{ scale: pop }], opacity: pop }}>
            <LinearGradient
              colors={[Colors.safe, Colors.safeDeep]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.badge}
            >
              <Ionicons name="checkmark" size={44} color={Colors.onColor} />
            </LinearGradient>
          </Animated.View>

          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.body}</Text>

          <Card style={styles.card}>
            <Overline>Location sharing stopped</Overline>
            <Text style={styles.cardBody}>
              Your live position is no longer visible to anyone. Only the time, the message
              and any photo stay in your history.
            </Text>
          </Card>
        </View>

        <View style={styles.footer}>
          <Button label="Back to home" icon="home" tone="safe" onPress={() => router.replace('/(tabs)')} />
        </View>
      </SafeAreaView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.md },
  badge: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center', marginBottom: Space.lg,
  },
  title: { ...Type.title, color: Colors.text, textAlign: 'center' },
  subtitle: { ...Type.body, color: Colors.muted, textAlign: 'center', maxWidth: 320 },
  card: { marginTop: Space.xl, gap: Space.sm, width: '100%' },
  cardBody: { ...Type.caption, color: Colors.muted },
  footer: { padding: Space.xl },
});
