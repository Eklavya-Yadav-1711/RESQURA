import React from 'react';
import {
  View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Space, Radius, Type, HIT } from '../theme';

// Shared building blocks. Every screen draws from these so a card, a pill or a
// button looks and behaves identically everywhere.

export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style, tone }) {
  return (
    <View style={[styles.card, tone === 'danger' && styles.cardDanger,
      tone === 'safe' && styles.cardSafe, style]}>
      {children}
    </View>
  );
}

export function Overline({ children, style }) {
  return <Text style={[styles.overline, style]}>{String(children).toUpperCase()}</Text>;
}

/** Primary action. `tone` picks the semantic colour, never decoration. */
export function Button({
  label, onPress, tone = 'danger', icon, loading, disabled,
  variant = 'solid', style, accessibilityHint,
}) {
  const inactive = disabled || loading;
  const palette = {
    danger: [Colors.danger, Colors.dangerDeep],
    safe: [Colors.safe, Colors.safeDeep],
  }[tone] || [Colors.elevated, Colors.elevated];

  const content = (
    <>
      {loading
        ? <ActivityIndicator color={variant === 'solid' ? Colors.onColor : Colors.text} />
        : (
          <>
            {icon && (
              <Ionicons
                name={icon}
                size={18}
                color={variant === 'solid' ? Colors.onColor : Colors.text}
              />
            )}
            <Text style={[styles.btnLabel, variant !== 'solid' && styles.btnLabelQuiet]}>
              {label}
            </Text>
          </>
        )}
    </>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(inactive) }}
      style={({ pressed }) => [
        styles.btnWrap,
        inactive && styles.btnDisabled,
        pressed && !inactive && styles.btnPressed,
        style,
      ]}
    >
      {variant === 'solid' ? (
        <LinearGradient colors={palette} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.btn}>
          {content}
        </LinearGradient>
      ) : (
        <View style={[styles.btn, styles.btnGhost, variant === 'outline' && {
          backgroundColor: 'transparent',
          borderColor: tone === 'danger' ? Colors.danger : Colors.border,
        }]}>
          {content}
        </View>
      )}
    </Pressable>
  );
}

/** Status chip. Always pairs colour with an icon or word — never colour alone. */
export function Pill({ label, tone = 'neutral', icon }) {
  const tones = {
    danger: [Colors.dangerSoft, Colors.danger],
    safe: [Colors.safeSoft, Colors.safe],
    warn: [Colors.warnSoft, Colors.warn],
    info: [Colors.infoSoft, Colors.info],
    neutral: [Colors.elevated, Colors.muted],
  };
  const [bg, fg] = tones[tone] || tones.neutral;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={12} color={fg} />}
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Stat({ value, label, tone }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
      <Text style={[styles.statValue, tone === 'safe' && { color: Colors.safe },
        tone === 'danger' && { color: Colors.danger }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40, tone = 'neutral' }) {
  const initials = (name || '')
    .split(' ').filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?';
  return (
    <View
      style={[styles.avatar, {
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: tone === 'danger' ? Colors.dangerSoft : Colors.elevated,
      }]}
    >
      <Text style={[styles.avatarText, {
        fontSize: size * 0.34,
        color: tone === 'danger' ? Colors.danger : Colors.text,
      }]}>
        {initials}
      </Text>
    </View>
  );
}

export function EmptyState({ icon, title, body }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={22} color={Colors.subtle} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
    </View>
  );
}

export function Field({ label, error, hint, icon, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error && styles.inputWrapError]}>
        {icon && <Ionicons name={icon} size={18} color={Colors.subtle} />}
        <TextInput
          placeholderTextColor={Colors.subtle}
          accessibilityLabel={label}
          style={styles.input}
          {...inputProps}
        />
      </View>
      {error ? (
        <Text style={styles.fieldError} accessibilityLiveRegion="polite" role="alert">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.fieldHint}>{hint}</Text>
      ) : null}
    </View>
  );
}

/** Round icon button with a guaranteed 48pt target. */
export function IconButton({ icon, onPress, label, tone = 'neutral', style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed, style]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={tone === 'danger' ? Colors.danger : Colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Space.lg,
  },
  cardDanger: { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: Colors.dangerSoft },
  cardSafe: { borderColor: 'rgba(34,197,94,0.3)', backgroundColor: Colors.safeSoft },

  overline: { ...Type.overline, color: Colors.subtle },

  btnWrap: { borderRadius: Radius.md, overflow: 'hidden' },
  btn: {
    minHeight: HIT + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  btnGhost: {
    backgroundColor: Colors.elevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnLabel: { ...Type.bodyStrong, color: Colors.onColor },
  btnLabelQuiet: { color: Colors.text },
  btnPressed: { opacity: 0.72 },
  btnDisabled: { opacity: 0.45 },

  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: Space.md, paddingVertical: 5, borderRadius: Radius.pill,
  },
  pillText: { ...Type.overline },

  stat: { flex: 1, alignItems: 'center', paddingVertical: Space.lg },
  statValue: { ...Type.numeric, color: Colors.text },
  statLabel: { ...Type.caption, color: Colors.muted, marginTop: 2 },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: Type.bodyStrong.fontFamily },

  empty: {
    alignItems: 'center', paddingVertical: Space.xxl, paddingHorizontal: Space.xl,
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.elevated,
    alignItems: 'center', justifyContent: 'center', marginBottom: Space.md,
  },
  emptyTitle: { ...Type.bodyStrong, color: Colors.text },
  emptyBody: { ...Type.caption, color: Colors.muted, textAlign: 'center', marginTop: Space.xs },

  field: { marginBottom: Space.lg },
  fieldLabel: { ...Type.label, color: Colors.muted, marginBottom: Space.sm },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    minHeight: HIT + 2, paddingHorizontal: Space.lg,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  inputWrapError: { borderColor: Colors.danger },
  input: { flex: 1, ...Type.body, color: Colors.text, paddingVertical: Space.md },
  fieldError: { ...Type.caption, color: Colors.danger, marginTop: 6 },
  fieldHint: { ...Type.caption, color: Colors.subtle, marginTop: 6 },

  iconBtn: {
    width: HIT - 4, height: HIT - 4, borderRadius: (HIT - 4) / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
});
