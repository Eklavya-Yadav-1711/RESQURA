import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Space, Radius, Type } from '../theme';

export default function Logo({ caption }) {
  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[Colors.danger, Colors.dangerDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.badge}
      >
        <Ionicons name="shield-checkmark" size={30} color={Colors.onColor} />
      </LinearGradient>
      <Text style={styles.name}>RESQORA</Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  badge: {
    width: 68, height: 68, borderRadius: Radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: Space.lg,
  },
  name: { ...Type.title, color: Colors.text, letterSpacing: 3 },
  caption: { ...Type.caption, color: Colors.muted, marginTop: Space.xs },
});
