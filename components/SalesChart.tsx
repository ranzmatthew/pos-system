import { View, Text, StyleSheet } from 'react-native';
import { C } from './ui';
import { pesos } from '../db/database';

// 7-day bars with plain Views. No chart lib needed.
// bars: [{ label: 'Mon', total: 12500 }]
export default function SalesChart({ bars }: { bars: { label: string; total: number }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.total));
  return (
    <View style={s.box}>
      <View style={s.bars}>
        {bars.map((b) => (
          <View key={b.label} style={s.col}>
            <View style={s.track}>
              <View style={[s.fill, { height: `${Math.max(6, (b.total / max) * 100)}%` }]} />
            </View>
            <Text style={s.day}>{b.label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.note}>Top day: P{pesos(max)} this week</Text>
    </View>
  );
}

const s = StyleSheet.create({
  box: { gap: 8 },
  bars: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: {
    height: 110,
    width: '100%',
    backgroundColor: C.chip,
    borderRadius: 8,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  fill: { backgroundColor: C.dark, borderRadius: 8 },
  day: { fontSize: 11, color: C.muted },
  note: { color: C.muted, fontSize: 12 },
});
