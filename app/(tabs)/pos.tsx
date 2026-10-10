import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, Alert, StyleSheet } from 'react-native';
import { getDb, initDb, saveSale, pesos, countUnsynced } from '../../db/database';
import { syncNow } from '../../sync/push';
import ProductCard from '../../components/ProductCard';
import CartRow from '../../components/CartRow';
import { C } from '../../components/ui';

type Product = { id: number; name: string; price: number; stock: number };
type Cart = { product: Product; qty: number };

// Staff home. Tap products, take cash, print.
// Works offline: sale saves locally, syncs later.
export default function PosScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart[]>([]);
  const [cash, setCash] = useState('');
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(0);

  async function refresh() {
    const rows = await getDb().getAllAsync<Product>(
      'SELECT id, name, price, stock FROM products ORDER BY name'
    );
    setProducts(rows);
    setPending(await countUnsynced());
  }

  useEffect(() => {
    (async () => {
      await initDb();
      await refresh();
    })();
  }, []);

  const total = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const shown = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  function addToCart(p: Product) {
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === p.id);
      if (found) return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product: p, qty: 1 }];
    });
  }

  function bump(id: number, d: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, qty: l.qty + d } : l))
        .filter((l) => l.qty > 0)
    );
  }

  async function checkout() {
    try {
      const cashNum = Math.round(Number(cash) * 100);
      if (cart.length === 0) return Alert.alert('Cart is empty', 'Tap a product first.');
      if (!cashNum || cashNum < total) return Alert.alert('Cash is not enough');
      const r = await saveSale(
        cart.map((l) => ({ productId: l.product.id, qty: l.qty })),
        cashNum
      );
      Alert.alert(
        'Sale saved',
        `Total P${pesos(r.total)}  Change P${pesos(r.change)}\nSale #${r.saleId} - tap Print on receipt.`
      );
      syncNow().catch(() => {});
      setCart([]);
      setCash('');
      await refresh();
    } catch (e: any) {
      Alert.alert('Checkout failed', e.message ?? 'Try again');
    }
  }

  return (
    <View style={s.page}>
      <View style={s.top}>
        <Text style={s.cashier}>Counter • Staff mode</Text>
        <Text style={pending === 0 ? s.ok : s.wait}>
          {pending === 0 ? 'Online' : `${pending} waiting to send`}
        </Text>
      </View>

      <TextInput style={s.search} value={q} onChangeText={setQ} placeholder="Search product..." />

      <FlatList
        data={shown}
        numColumns={2}
        keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ gap: 10, paddingBottom: 190 }}
        renderItem={({ item }) => (
          <ProductCard name={item.name} price={item.price} stock={item.stock} onPress={() => addToCart(item)} />
        )}
        ListEmptyComponent={<Text style={s.empty}>No products yet. Owner adds them in Stock.</Text>}
      />

      <View style={s.sheet}>
        <Text style={s.sheetTitle}>Cart • P{pesos(total)}</Text>
        {cart.length === 0 && <Text style={s.empty}>Tap items above to add.</Text>}
        {cart.map((l) => (
          <CartRow
            key={l.product.id}
            name={l.product.name}
            qty={l.qty}
            price={l.product.price}
            onMinus={() => bump(l.product.id, -1)}
            onPlus={() => bump(l.product.id, 1)}
          />
        ))}
        <View style={s.cashRow}>
          <TextInput
            style={s.cash}
            value={cash}
            onChangeText={setCash}
            placeholder="Cash, e.g. 500"
            keyboardType="numeric"
          />
          <Pressable style={s.pay} onPress={checkout}>
            <Text style={s.payText}>Charge</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg, padding: 12 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cashier: { fontWeight: '800' },
  ok: { color: C.green, fontWeight: '700' },
  wait: { color: C.orange, fontWeight: '700' },
  search: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10, marginBottom: 10 },
  empty: { color: C.muted, textAlign: 'center', marginVertical: 8 },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 12,
  },
  sheetTitle: { fontSize: 17, fontWeight: '900', marginBottom: 4 },
  cashRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  cash: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12 },
  pay: { backgroundColor: C.dark, paddingHorizontal: 26, justifyContent: 'center', borderRadius: 10 },
  payText: { color: '#fff', fontWeight: '800', fontSize: 16 },
});
