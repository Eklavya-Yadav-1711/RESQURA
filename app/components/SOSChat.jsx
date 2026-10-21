import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSOSMessages, sendSOSMessage } from '../services/api';
import { Colors, Space, Radius, Type } from '../theme';

export default function SOSChat({ sosId, userId }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    load();
    const timer = setInterval(load, 5000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [sosId]);

  async function load() {
    try {
      const next = await getSOSMessages(sosId);
      if (mounted.current) setMessages(next);
    } catch {
      // The parent screen already surfaces SOS connection failures.
    } finally {
      if (mounted.current) setLoading(false);
    }
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await sendSOSMessage(sosId, body);
      if (mounted.current) {
        setDraft('');
        if (result.message) setMessages((current) => [...current, result.message]);
      }
    } catch (err) {
      if (mounted.current) {
        setDraft(body);
        Alert.alert('Message not sent', err.message || 'Could not send this message. Try again.');
      }
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.title}>SOS group chat</Text>
          <Text style={styles.subtitle}>Share what you have and what you need</Text>
        </View>
        <Ionicons name="chatbubbles" size={22} color={Colors.danger} />
      </View>

      <ScrollView style={styles.messages} contentContainerStyle={styles.messageList}>
        {loading ? <ActivityIndicator color={Colors.danger} /> : messages.length === 0 ? (
          <Text style={styles.empty}>No messages yet. Tell everyone what would help.</Text>
        ) : messages.map((message) => {
          const mine = String(message.senderId) === String(userId);
          return (
            <View key={message.id} style={[styles.message, mine && styles.mine]}>
              {!mine && <Text style={styles.sender}>{message.senderName}</Text>}
              <Text style={[styles.body, mine && styles.mineBody]}>{message.body}</Text>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="I have a rope…"
          placeholderTextColor={Colors.subtle}
          multiline
          maxLength={500}
          editable={!sending}
          accessibilityLabel="SOS group message"
          style={styles.input}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel="Send group message"
          style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}
        >
          <Ionicons name="send" size={18} color={Colors.onColor} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: Space.lg,
    gap: Space.md, marginTop: Space.lg,
  },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...Type.bodyStrong, color: Colors.text },
  subtitle: { ...Type.caption, color: Colors.muted, marginTop: 2 },
  messages: { minHeight: 42, maxHeight: 230 },
  messageList: { gap: Space.sm },
  empty: { ...Type.caption, color: Colors.muted, textAlign: 'center', paddingVertical: Space.sm },
  message: {
    alignSelf: 'flex-start', maxWidth: '88%', backgroundColor: Colors.elevated,
    borderRadius: Radius.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.dangerDeep },
  sender: { ...Type.caption, color: Colors.danger, marginBottom: 2 },
  body: { ...Type.body, color: Colors.text },
  mineBody: { color: Colors.onColor },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.sm },
  input: {
    flex: 1, minHeight: 44, maxHeight: 100, ...Type.body, color: Colors.text,
    backgroundColor: Colors.elevated, borderRadius: Radius.sm, paddingHorizontal: Space.md,
    paddingVertical: Space.sm, textAlignVertical: 'top',
  },
  send: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
