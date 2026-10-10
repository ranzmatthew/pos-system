import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C } from './ui';
import { pesos } from '../db/database';

// One row in the cart sheet. Minus / plus keeps cashier fast.
export default function CartRow({
  name,
  qty,
  price,
  onMinus,
  onPlus,
}: {
  name: string;
  qty: number;
  price: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={s.sub}>P{pesos(price)} each</Text>
      </View>
      <View style={s.step}>
        <Pressable style={s.stepBtn} onPress={onMinus}>
          <Text style={s.stepText}>-</Text>
        </Pressable>
        <Text style={s.qty}>{qty}</Text>
        <Pressable style={s.stepBtn} onPress={onPlus}>
          <Text style={s.stepText}>+</Text>
        </Pressable>
      </View>
      <Text style={s.total}>P{pesos(price * qty)}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  name: { fontWeight: '700' },
  sub: { color: C.muted, fontSize: 12 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 18, fontWeight: '800' },
  qty: { minWidth: 20, textAlign: 'center', fontWeight: '800' },
  total: { minWidth: 72, textAlign: 'right', fontWeight: '800' },
});
