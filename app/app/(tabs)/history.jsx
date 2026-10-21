import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, RefreshControl, ActivityIndicator, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getHistory, getSOSImageSource } from '../../services/api';
import { formatDay, formatDuration, formatTime } from '../../services/format';
import { Avatar, Card, EmptyState, Overline, Pill, Screen } from '../../components/ui';
import ConnectionBanner from '../../components/ConnectionBanner';
import Photo from '../../components/Photo';
import { Colors, Space, Radius, Type } from '../../theme';

export default function History() {
  const router = useRouter();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await getHistory();
      const events = Array.isArray(data.history)
        ? data.history.map((event) => ({
            ...event,
            responders: Array.isArray(event.responders)
              ? event.responders
              : Array.isArray(event.sos_responders) ? event.sos_responders : [],
          }))
        : [];
      setTotal(events.length);

      const groups = new Map();
      events.forEach((event) => {
        const day = formatDay(event.started_at);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(event);
      });
      setSections([...groups].map(([title, data]) => ({ title, data })));
    } catch {}
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  // Coming back to this tab should not show a stale "Active" row.
  useFocusEffect(React.useCallback(() => { load(); }, [load]));

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={Colors.danger} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ConnectionBanner />
        <View style={styles.head}>
          <Text style={styles.title}>History</Text>
          {total > 0 && <Text style={styles.count}>{total}</Text>}
        </View>

        <SectionList
          sections={sections}
          keyExtractor={(item) => String(item.id)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.danger} />
          }
          renderSectionHeader={({ section }) => (
            <Overline style={styles.day}>{section.title}</Overline>
          )}
          renderItem={({ item }) => (
            <Event
              event={item}
              onPress={item.status === 'active'
                ? () => router.push({
                    pathname: '/sos-active',
                    params: {
                      sosId: String(item.id),
                      startedAt: item.started_at || '',
                      alertedCount: String(responderCount(item)),
                    },
                  })
                : undefined}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="time-outline"
              title="No emergencies yet"
              body="Every SOS you send is kept here — time, message, photo and who came."
            />
          }
        />
      </SafeAreaView>
    </Screen>
  );
}

function responderCount(event) {
  return Array.isArray(event.responders)
    ? event.responders.length
    : Array.isArray(event.sos_responders) ? event.sos_responders.length : 0;
}

const Event = React.memo(function Event({ event, onPress }) {
  const resolved = event.status === 'resolved';
  const responders = Array.isArray(event.responders) ? event.responders : [];
  const duration = formatDuration(event.started_at, event.ended_at);
  const photo = getSOSImageSource(event);

  const card = (
    <Card style={styles.event}>
      <View style={[styles.spine, { backgroundColor: resolved ? Colors.safe : Colors.danger }]} />

      <View style={styles.eventBody}>
        <View style={styles.eventTop}>
          <Pill
            label={resolved ? 'Resolved' : 'Active'}
            tone={resolved ? 'safe' : 'danger'}
            icon={resolved ? 'checkmark-circle' : 'radio'}
          />
          <Text style={styles.time}>{formatTime(event.started_at)}</Text>
        </View>

        {onPress && (
          <View style={styles.resume}>
            <Ionicons name="arrow-forward-circle" size={16} color={Colors.danger} />
            <Text style={styles.resumeText}>Still running — tap to open it</Text>
          </View>
        )}

        <Text style={styles.message} numberOfLines={2}>“{event.message}”</Text>

        <Photo
          source={photo}
          height={150}
          caption={formatTime(event.started_at)}
          accessibilityLabel="Photo shared with this alert"
        />

        <View style={styles.meta}>
          {duration && <Text style={styles.metaText}>{duration}</Text>}
          <Text style={styles.metaText}>
            {responders.length === 0
              ? 'Nobody responded'
              : `${responders.length} came to help`}
          </Text>
        </View>

          {responders.length > 0 && (
          <View style={styles.people}>
              {responders.map((r) => (
              <View key={r.id} style={styles.person}>
                <Avatar name={r.name} size={26} />
                <Text style={styles.personName} numberOfLines={1}>{r.name}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Card>
  );

  if (!onPress) return card;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open this active emergency"
      style={({ pressed }) => pressed && { opacity: 0.75 }}
    >
      {card}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Space.xl, paddingTop: Space.md, paddingBottom: Space.lg,
  },
  title: { ...Type.title, color: Colors.text },
  count: { ...Type.label, color: Colors.subtle },

  list: { paddingHorizontal: Space.xl, paddingBottom: Space.xxl },
  day: { marginTop: Space.lg, marginBottom: Space.md },

  event: { flexDirection: 'row', padding: 0, overflow: 'hidden', marginBottom: Space.md },
  spine: { width: 3 },
  eventBody: { flex: 1, padding: Space.lg, gap: Space.md },
  eventTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { ...Type.caption, color: Colors.subtle },
  message: { ...Type.body, color: Colors.text },
  resume: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  resumeText: { ...Type.label, color: Colors.danger },
  meta: { flexDirection: 'row', gap: Space.lg, flexWrap: 'wrap' },
  metaText: { ...Type.caption, color: Colors.muted },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  person: {
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: Colors.elevated, borderRadius: Radius.pill,
    paddingLeft: 4, paddingRight: Space.md, paddingVertical: 4,
  },
  personName: { ...Type.caption, color: Colors.text, maxWidth: 120 },
});
