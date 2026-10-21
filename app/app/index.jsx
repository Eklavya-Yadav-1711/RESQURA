import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { getStoredUser } from '../services/api';
import { Colors } from '../theme';

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    getStoredUser().then((user) => {
      if (!cancelled) router.replace(user ? '/(tabs)' : '/login');
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={Colors.danger} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
});
