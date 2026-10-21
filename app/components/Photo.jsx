import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Image, Pressable, Modal, ActivityIndicator, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Space, Radius, Type, HIT } from '../theme';

/**
 * A tappable SOS photo. Tapping opens it full screen, because a thumbnail of
 * an emergency scene is rarely enough to act on.
 */
export default function Photo({ source, style, height = 160, caption, accessibilityLabel }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  if (!source) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel={accessibilityLabel || 'Photo shared with this alert'}
        accessibilityHint="Opens the photo full screen"
        style={({ pressed }) => [styles.thumbWrap, { height }, pressed && styles.pressed, style]}
      >
        <Image
          source={source}
          style={styles.thumb}
          resizeMode="cover"
          onLoadEnd={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
        />

        {loading && !failed && (
          <View style={styles.overlay}>
            <ActivityIndicator color={Colors.muted} />
          </View>
        )}

        {failed && (
          <View style={styles.overlay}>
            <Ionicons name="image-outline" size={22} color={Colors.subtle} />
            <Text style={styles.failedText}>Photo unavailable</Text>
          </View>
        )}

        {!failed && (
          <View style={styles.expandBadge} pointerEvents="none">
            <Ionicons name="expand" size={14} color={Colors.onColor} />
          </View>
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.viewer}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />

          <SafeAreaView style={styles.viewerInner} edges={['top', 'bottom']} pointerEvents="box-none">
            <View style={styles.viewerBar}>
              {caption ? <Text style={styles.caption} numberOfLines={1}>{caption}</Text> : <View />}
              <Pressable
                onPress={() => setOpen(false)}
                accessibilityRole="button"
                accessibilityLabel="Close photo"
                hitSlop={12}
                style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={22} color={Colors.onColor} />
              </Pressable>
            </View>

            <Image
              source={source}
              style={styles.full}
              resizeMode="contain"
              accessibilityLabel={accessibilityLabel || 'Photo shared with this alert'}
            />
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const { width, height: screenHeight } = Dimensions.get('window');

const styles = StyleSheet.create({
  thumbWrap: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.elevated,
  },
  thumb: { width: '100%', height: '100%' },
  pressed: { opacity: 0.8 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center', gap: Space.sm,
    backgroundColor: Colors.elevated,
  },
  failedText: { ...Type.caption, color: Colors.subtle },
  expandBadge: {
    position: 'absolute', right: Space.sm, bottom: Space.sm,
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },

  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' },
  viewerInner: { flex: 1 },
  viewerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Space.lg, paddingVertical: Space.sm,
  },
  caption: { flex: 1, ...Type.label, color: Colors.onColor },
  close: {
    width: HIT - 8, height: HIT - 8, borderRadius: (HIT - 8) / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  full: { flex: 1, width: width, maxHeight: screenHeight },
});
