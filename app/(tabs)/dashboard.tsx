import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { getDb, initDb, pesos } from '../../db/database';
import SalesChart from '../../components/SalesChart';
import { C } from '../../components/ui';

// Owner home. Works from anywhere once sync is on.
export default function DashboardScreen() {
  const [today, setToday] = useState({ total: 0, profit: 0, count: 0 });
  const [week, setWeek] = useState<{ label: string; total: number }[]>([]);
  const [low, setLow] = useState<{ name: string; stock: number }[]>([]);
  const [recent, setRecent] = useState<{ id: number; total: number; created_at: string }[]>([]);

  useEffect(() => {
    (async () => {
      await initDb();
      const d = getDb();
      const t = await d.getFirstAsync<{ total: number; profit: number; count: number }>(
        "SELECT COALESCE(SUM(total),0) as total, COALESCE(SUM(profit),0) as profit, COUNT(*) as count FROM sales WHERE date(created_at) = date('now')"
      );
      if (t) setToday(t);
      const w = await d.getAllAsync<{ label: string; total: number }>(
        "SELECT strftime('%w', created_at) as label, COALESCE(SUM(total),0) as total FROM sales WHERE created_at >= date('now','-6 days') GROUP BY label"
      );
      const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
      setWeek(days.map((day, i) => ({ label: day, total: w.find((x) => Number(x.label) === i)?.total ?? 0 })));
      setLow(
        await d.getAllAsync<{ name: string; stock: number }>(
          'SELECT name, stock FROM products WHERE stock <= 5 ORDER BY stock LIMIT 10'
        )
      );
      setRecent(
        await d.getAllAsync<{ id: number; total: number; created_at: string }>(
          'SELECT id, total, created_at FROM sales ORDER BY id DESC LIMIT 8'
        )
      );
    })();
  }, []);

  return (
    <ScrollView style={s.page} contentContainerStyle={{ gap: 12, padding: 12, paddingBottom: 24 }}>
      <Text style={s.title}>Hello, Owner</Text>

      <View style={s.cards}>
        <View style={s.card}>
          <Text style={s.k}>Today sales</Text>
          <Text style={s.v}>P{pesos(today.total)}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.k}>Profit</Text>
          <Text style={[s.v, { color: C.green }]}>P{pesos(today.profit)}</Text>
        </View>
      </View>
      <View style={s.cards}>
        <View style={s.card}>
          <Text style={s.k}>Receipts</Text>
          <Text style={s.v}>{today.count}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.k}>Status</Text>
          <Text style={s.v}>{today.count === 0 ? 'No sales yet' : 'Selling'}</Text>
        </View>
      </View>

      <View style={s.panel}>
        <Text style={s.h}>This week</Text>
        <SalesChart bars={week.length ? week : [{ label: 'Today', total: today.total }]} />
      </View>

      <View style={s.panel}>
        <Text style={s.h}>Restock soon</Text>
        {low.length === 0 && <Text style={s.muted}>All good - nothing low.</Text>}
        {low.map((p) => (
          <View key={p.name} style={s.line}>
            <Text style={s.bold}>{p.name}</Text>
            <Text style={s.lowText}>{p.stock} left</Text>
          </View>
        ))}
      </View>

      <View style={s.panel}>
        <Text style={s.h}>Latest sales</Text>
        {recent.length === 0 && <Text style={s.muted}>No sales logged yet.</Text>}
        {recent.map((r) => (
          <View key={r.id} style={s.line}>
            <Text style={s.bold}>Receipt #{r.id}</Text>
            <Text>P{pesos(r.total)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  title: { fontSize: 22, fontWeight: '900' },
  cards: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12 },
  k: { color: C.muted, fontSize: 12 },
  v: { fontSize: 18, fontWeight: '900', marginTop: 2 },
  panel: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, gap: 6 },
  h: { fontSize: 16, fontWeight: '800' },
  muted: { color: C.muted },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 1, borderTopColor: C.line },
  bold: { fontWeight: '700' },
  lowText: { color: C.red, fontWeight: '800' },
});
