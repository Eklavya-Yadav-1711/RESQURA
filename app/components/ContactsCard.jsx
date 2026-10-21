import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getContacts, addContact, removeContact } from '../services/api';
import { Avatar, Button, Card, Field, Overline } from './ui';
import { Colors, Space, Radius, Type, HIT } from '../theme';

/**
 * The people told directly when you raise an SOS. Without these, an alert in
 * an empty area reaches nobody at all.
 */
export default function ContactsCard({ onChange }) {
  const [contacts, setContacts] = useState([]);
  const [max, setMax] = useState(5);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [error, setError] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const data = await getContacts();
      setContacts(data.contacts || []);
      setMax(data.max || 5);
      onChange?.(data.contacts || []);
    } catch {}
  }

  async function save() {
    setError(null);
    if (!form.name.trim()) return setError('Give this contact a name');
    if (!form.phone.trim()) return setError('Enter their phone number');

    setSaving(true);
    try {
      const data = await addContact(form.name.trim(), form.phone.trim());
      const nextContacts = Array.isArray(data.contacts) ? data.contacts : [];
      setContacts(nextContacts);
      onChange?.(nextContacts);
      setForm({ name: '', phone: '' });
      setAdding(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove(contact) {
    Alert.alert('Remove contact?', `${contact.name} will no longer be texted when you raise an SOS.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const data = await removeContact(contact.id);
            const nextContacts = Array.isArray(data.contacts) ? data.contacts : [];
            setContacts(nextContacts);
            onChange?.(nextContacts);
          } catch (err) {
            Alert.alert('Could not remove', err.message);
          }
        },
      },
    ]);
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Overline>Emergency contacts</Overline>
        <Text style={styles.count}>{contacts.length}/{max}</Text>
      </View>

      <Text style={styles.blurb}>
        They get a text with your live location the moment you raise an SOS —
        even if nobody is nearby.
      </Text>

      {contacts.map((contact) => (
        <View key={contact.id} style={styles.row}>
          <Avatar name={contact.name} size={36} />
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>{contact.name}</Text>
            <Text style={styles.phone}>{contact.phone}</Text>
          </View>
          <Pressable
            onPress={() => confirmRemove(contact)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${contact.name}`}
            hitSlop={10}
            style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={16} color={Colors.muted} />
          </Pressable>
        </View>
      ))}

      {adding ? (
        <View style={styles.form}>
          <Field
            label="Name"
            icon="person-outline"
            placeholder="Mum, flatmate, best friend…"
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          />
          <Field
            label="Phone number"
            icon="call-outline"
            placeholder="98765 43210"
            value={form.phone}
            onChangeText={(v) => setForm((f) => ({ ...f, phone: v }))}
            keyboardType="phone-pad"
            error={error}
          />
          <View style={styles.formActions}>
            <Button label="Save" onPress={save} loading={saving} tone="safe" style={styles.grow} />
            <Button
              label="Cancel"
              variant="ghost"
              onPress={() => { setAdding(false); setError(null); }}
              style={styles.grow}
            />
          </View>
        </View>
      ) : (
        <Button
          label={contacts.length ? 'Add another' : 'Add a contact'}
          icon="person-add"
          variant="ghost"
          onPress={() => setAdding(true)}
          disabled={contacts.length >= max}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  count: { ...Type.label, color: Colors.subtle },
  blurb: { ...Type.caption, color: Colors.muted },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Space.md,
    backgroundColor: Colors.elevated, borderRadius: Radius.md, padding: Space.md,
  },
  rowText: { flex: 1 },
  name: { ...Type.bodyStrong, color: Colors.text },
  phone: { ...Type.caption, color: Colors.muted },
  remove: {
    width: HIT - 16, height: HIT - 16, borderRadius: (HIT - 16) / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  form: { gap: 0 },
  formActions: { flexDirection: 'row', gap: Space.md },
  grow: { flex: 1 },
});
