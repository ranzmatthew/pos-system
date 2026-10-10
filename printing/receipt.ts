// 58mm receipt text builder (ESC/POS friendly, 32 chars per line).
// Money in centavos. 12500 -> "125.00"

function pesos(c: number): string {
  return (c / 100).toFixed(2);
}

function line(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

export type ReceiptLine = { name: string; qty: number; price: number };

export function buildReceipt(opts: {
  storeName: string;
  saleId: number;
  date: string;
  lines: ReceiptLine[];
  total: number;
  cash: number;
  change: number;
}): string {
  const out: string[] = [];
  out.push('================================');
  out.push(center(opts.storeName));
  out.push(center(`Sale #${opts.saleId}  ${opts.date}`));
  out.push('================================');
  for (const l of opts.lines) {
    out.push(l.name.slice(0, 32));
    out.push(line(`  ${l.qty} x ${pesos(l.price)}`, pesos(l.price * l.qty)));
  }
  out.push('--------------------------------');
  out.push(line('TOTAL', pesos(opts.total)));
  out.push(line('CASH', pesos(opts.cash)));
  out.push(line('CHANGE', pesos(opts.change)));
  out.push('================================');
  out.push(center('Thank you!'));
  out.push('\n\n\n');
  return out.join('\n');
}

function center(t: string, width = 32): string {
  const pad = Math.max(0, Math.floor((width - t.length) / 2));
  return ' '.repeat(pad) + t;
}
