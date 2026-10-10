// Bluetooth printer hook point.
// Most 58mm printers use Classic Bluetooth + ESC/POS.
// Plain Expo Go cannot print - use an Expo Dev Client build
// plus a native print module (e.g. react-native-esc-pos or BLE lib
// matching your exact printer model).

export type PrinterStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export const PRINTER_NOTES = [
  '1. Pair the printer in Android Settings first.',
  '2. Connect here and save its address.',
  '3. Print receipts one at a time, allow reprint.',
  '4. Test with your exact 58mm model early.',
];
