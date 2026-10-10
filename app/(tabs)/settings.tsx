import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useAuth } from '../../auth/context';
import { initDb, countUnsynced, countUnsyncedProducts, getSyncValue } from '../../db/database';
import { syncNow } from '../../sync/push';
import { pullProducts } from '../../sync/pull';
import { isSupabaseConfigured } from '../../lib/supabase';
import { C } from '../../components/ui';

// Printer + sync + role. One place for store setup.
export default function SettingsScreen() {
  const { profile, signOut } = useAuth();
  const [pending, setPending] = useState(0);
  const [lastPush, setLastPush] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await initDb();
    setPending((await countUnsynced()) + (await countUnsyncedProducts()));
    setLastPush(await getSyncValue('last_push'));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onSync() {
    setBusy(true);
    try {
      const r = await syncNow();
      const pulled = await pullProducts();
      await refresh();
      Alert.alert('Sync', `${r.note}\n${pulled.note}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.page} contentContainerStyle={{ gap: 12, padding: 12, paddingBottom: 24 }}>
      <Text style={s.title}>More</Text>

      <View style={s.card}>
        <Text style={s.h}>Signed in</Text>
        <Text>{profile?.email}</Text>
        <Text style={s.muted}>{profile?.role === 'owner' ? 'Owner account' : 'Staff account'}</Text>
        <Pressable style={s.ghost} onPress={() => signOut().catch((e) => Alert.alert('Sign out failed', e.message))}>
          <Text style={s.ghostText}>Sign out</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Receipt printer • 58mm</Text>
        <Text style={s.muted}>Pair in Android Bluetooth first, then connect here.</Text>
        <View style={s.row}>
          <Text style={s.dot}>●</Text>
          <Text>Printer: not connected</Text>
        </View>
        <Pressable style={s.dark} onPress={() => Alert.alert('Next step', 'Add bluetooth connect + test print here.')}>
          <Text style={s.darkText}>Find printer</Text>
        </Pressable>
        <Pressable style={s.ghost} onPress={() => Alert.alert('Test', 'Prints one test receipt.')}>
          <Text style={s.ghostText}>Print test receipt</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Online sync</Text>
        <Text style={pending === 0 ? s.green : s.orange}>
          {pending === 0 ? 'All queued changes are online.' : `${pending} change(s) are waiting on this phone.`}
        </Text>
        <Text style={s.muted}>
          {isSupabaseConfigured() ? `Last sent: ${lastPush || 'never yet'}` : 'Add online keys in .env to go live.'}
        </Text>
        <Pressable style={[s.dark, busy && s.dim]} onPress={onSync} disabled={busy}>
          <Text style={s.darkText}>{busy ? 'Sending...' : 'Send now'}</Text>
        </Pressable>
        <Pressable style={s.ghost} onPress={refresh}>
          <Text style={s.ghostText}>Refresh status</Text>
        </Pressable>
      </View>

      <View style={s.card}>
        <Text style={s.h}>Who can do what</Text>
        <Text>Owner: stock, prices, profit, voids.</Text>
        <Text>Staff: POS sales + reprint only.</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  title: { fontSize: 22, fontWeight: '900' },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, gap: 8 },
  h: { fontSize: 16, fontWeight: '800' },
  muted: { color: C.muted },
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { color: C.orange, fontSize: 18 },
  green: { color: C.green, fontWeight: '700' },
  orange: { color: C.orange, fontWeight: '700' },
  dark: { backgroundColor: C.dark, padding: 12, borderRadius: 10, marginTop: 4 },
  darkText: { color: '#fff', textAlign: 'center', fontWeight: '800' },
  dim: { opacity: 0.6 },
  ghost: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.dark },
  ghostText: { textAlign: 'center', fontWeight: '800' },
});
