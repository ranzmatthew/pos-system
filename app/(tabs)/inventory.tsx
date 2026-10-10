import { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, Alert, StyleSheet } from 'react-native';
import { getDb, initDb, makeClientUuid, pesos } from '../../db/database';
import { C } from '../../components/ui';

type Product = { id: number; name: string; price: number; cost: number; stock: number };

// Owner only. Staff never opens this tab.
export default function InventoryScreen() {
  const [items, setItems] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function refresh() {
    const rows = await getDb().getAllAsync<Product>('SELECT * FROM products ORDER BY name');
    setItems(rows);
  }

  useEffect(() => {
    (async () => {
      await initDb();
      await refresh();
    })();
  }, []);

  const shown = items.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const lowCount = items.filter((p) => p.stock <= 5).length;

  async function addProduct() {
    if (!name.trim()) return Alert.alert('Name is required');
    const p = Math.round(Number(price) * 100) || 0;
    const c = Math.round(Number(cost) * 100) || 0;
    const st = Number(stock) || 0;
    await getDb().runAsync('INSERT INTO products (client_uuid, name, price, cost, stock) VALUES (?, ?, ?, ?, ?)', [
      makeClientUuid(),
      name.trim(),
      p,
      c,
      st,
    ]);
    setName('');
    setPrice('');
    setCost('');
    setStock('');
    setShowForm(false);
    await refresh();
  }

  return (
    <View style={s.page}>
      <View style={s.head}>
        <View>
          <Text style={s.title}>Stock</Text>
          <Text style={s.sub}>
            {items.length} items • {lowCount} low
          </Text>
        </View>
        <Pressable style={s.add} onPress={() => setShowForm((v) => !v)}>
          <Text style={s.addText}>{showForm ? 'Close' : '+ Add'}</Text>
        </Pressable>
      </View>

      {showForm && (
        <View style={s.card}>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name, e.g. Coke 500ml" />
          <View style={s.two}>
            <TextInput style={[s.input, s.half]} value={price} onChangeText={setPrice} placeholder="Price" keyboardType="numeric" />
            <TextInput style={[s.input, s.half]} value={cost} onChangeText={setCost} placeholder="Cost" keyboardType="numeric" />
          </View>
          <TextInput style={s.input} value={stock} onChangeText={setStock} placeholder="Stock, e.g. 50" keyboardType="numeric" />
          <Pressable style={s.save} onPress={addProduct}>
            <Text style={s.saveText}>Save product</Text>
          </Pressable>
        </View>
      )}

      <TextInput style={s.search} value={q} onChangeText={setQ} placeholder="Search stock..." />

      <FlatList
        data={shown}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
        renderItem={({ item }) => (
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.meta}>
                Sell P{pesos(item.price)} • Cost P{pesos(item.cost)}
              </Text>
            </View>
            <View style={s.right}>
              <Text style={s.stock}>{item.stock}</Text>
              {item.stock <= 5 ? <Text style={s.low}>LOW</Text> : <Text style={s.ok}>OK</Text>}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No matches. Add a product above.</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, padding: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '900' },
  sub: { color: C.muted },
  add: { backgroundColor: C.dark, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  addText: { color: '#fff', fontWeight: '800' },
  card: { backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 10, gap: 8 },
  input: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 },
  two: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  save: { backgroundColor: C.dark, padding: 12, borderRadius: 10 },
  saveText: { color: '#fff', textAlign: 'center', fontWeight: '800' },
  search: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 10 },
  row: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 12, flexDirection: 'row', alignItems: 'center' },
  name: { fontWeight: '700' },
  meta: { color: C.muted, fontSize: 12, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 2 },
  stock: { fontSize: 18, fontWeight: '900' },
  low: { color: C.red, fontWeight: '800', fontSize: 12 },
  ok: { color: C.green, fontWeight: '800', fontSize: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 12 },
});
