import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from './ui';
import { pesos } from '../db/database';

// Product tile for POS grid. Big tap area for cashier thumbs.
export default function ProductCard({
  name,
  price,
  stock,
  onPress,
}: {
  name: string;
  price: number;
  stock: number;
  onPress: () => void;
}) {
  const low = stock <= 5;
  return (
    <Pressable style={[s.card, low && s.lowCard]} onPress={onPress}>
      <Text style={s.name} numberOfLines={2}>
        {name}
      </Text>
      <Text style={s.price}>P{pesos(price)}</Text>
      <Text style={[s.stock, low && s.lowText]}>{low ? `Only ${stock} left` : `Stock ${stock}`}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 150,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    padding: 12,
    gap: 2,
  },
  lowCard: { borderColor: '#E5A49E' },
  name: { fontWeight: '700', fontSize: 14 },
  price: { fontWeight: '800', fontSize: 16, marginTop: 4 },
  stock: { color: C.muted, fontSize: 12 },
  lowText: { color: C.red, fontWeight: '700' },
});
