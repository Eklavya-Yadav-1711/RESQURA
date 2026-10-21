import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Linking, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getNearestHelp } from '../services/api';
import { formatKm } from '../services/format';
import { Button, Card, Overline } from './ui';
import { Colors, Space, Radius, Type } from '../theme';

const KIND = {
  police: { icon: 'shield', label: 'Police', tone: '#60A5FA' },
  hospital: { icon: 'medkit', label: 'Hospital', tone: '#22C55E' },
};

/**
 * Official help near you — police stations and hospitals from OpenStreetMap,
 * plus the national emergency lines. RESQORA calls neighbours; this is for
 * when you need the state.
 */
export default function NearestHelp({ location, compact }) {
  const [places, setPlaces] = useState([]);
  const [hotlines, setHotlines] = useState([{ label: 'Emergency', number: '112', primary: true }]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(!compact);

  // Round to ~100 m: GPS jitter must not re-query on every fix.
  const coarse = Number.isFinite(location?.lat)
    ? `${location.lat.toFixed(3)},${location.lon.toFixed(3)}`
    : null;

  const load = useCallback(async () => {
    if (!location?.lat) return;
    setLoading(true);
    try {
      const data = await getNearestHelp(location.lat, location.lon);
      setPlaces(data.places || []);
      setHotlines(data.hotlines?.length ? data.hotlines : hotlines);
      setFailed(Boolean(data.failed));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [coarse]);

  useEffect(() => { load(); }, [load]);

  function call(number) {
    const url = `tel:${String(number).replace(/[^\d+]/g, '')}`;
    Linking.openURL(url).catch(() =>
      Alert.alert('Cannot place the call', `Dial ${number} from your phone app.`)
    );
  }

  function directionsTo(place) {
    const url = Platform.select({
      ios: `maps://?daddr=${place.lat},${place.lon}`,
      default: `geo:${place.lat},${place.lon}?q=${place.lat},${place.lon}(${encodeURIComponent(place.name)})`,
    });
    Linking.openURL(url).catch(() =>
      Linking.openURL(
        `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=16/${place.lat}/${place.lon}`
      )
    );
  }

  const primary = hotlines.find((h) => h.primary) || hotlines[0];
  const shown = expanded ? places : places.slice(0, 1);

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Overline>Official help</Overline>
        {loading && <ActivityIndicator size="small" color={Colors.subtle} />}
      </View>

      <Button
        label={`Call ${primary.number}`}
        icon="call"
        onPress={() => call(primary.number)}
        accessibilityHint={primary.label}
      />

      {failed && !places.length ? (
        <Text style={styles.note}>
          Could not look up nearby stations right now. The number above always works.
        </Text>
      ) : null}

      {shown.map((place) => {
        const meta = KIND[place.kind] || KIND.police;
        return (
          <View key={place.id} style={styles.place}>
            <View style={[styles.badge, { backgroundColor: `${meta.tone}22` }]}>
              <Ionicons name={meta.icon} size={16} color={meta.tone} />
            </View>

            <View style={styles.placeText}>
              <Text style={styles.placeName} numberOfLines={1}>{place.name}</Text>
              <Text style={styles.placeMeta} numberOfLines={1}>
                {meta.label} · {formatKm(place.distance)}
                {place.address ? ` · ${place.address}` : ''}
              </Text>
            </View>

            {place.phone && (
              <Pressable
                onPress={() => call(place.phone)}
                accessibilityRole="button"
                accessibilityLabel={`Call ${place.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}
              >
                <Ionicons name="call" size={16} color={Colors.text} />
              </Pressable>
            )}

            {!place.fallback && (
              <Pressable
                onPress={() => directionsTo(place)}
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${place.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.iconAction, pressed && styles.pressed]}
              >
                <Ionicons name="navigate" size={16} color={Colors.text} />
              </Pressable>
            )}
          </View>
        );
      })}

      {places.length > 1 && (
        <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.more}>
            {expanded ? 'Show less' : `Show ${places.length - 1} more nearby`}
          </Text>
        </Pressable>
      )}

      {places.length > 0 && (
        <Text style={styles.credit}>Places from OpenStreetMap contributors</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  note: { ...Type.caption, color: Colors.muted },
  place: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    backgroundColor: Colors.elevated, borderRadius: Radius.md, padding: Space.md,
  },
  badge: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  placeText: { flex: 1 },
  placeName: { ...Type.bodyStrong, color: Colors.text },
  placeMeta: { ...Type.caption, color: Colors.muted },
  iconAction: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  pressed: { opacity: 0.7 },
  more: { ...Type.label, color: Colors.info, textAlign: 'center', paddingVertical: Space.xs },
  credit: { ...Type.caption, color: Colors.subtle, fontSize: 11 },
});
