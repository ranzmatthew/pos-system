// Who can do what. Owner sees all, staff only sells.
export type Role = 'owner' | 'staff';

export function canSell(role: Role): boolean {
  return role === 'owner' || role === 'staff';
}

export function canEditInventory(role: Role): boolean {
  return role === 'owner';
}

export function canSeeProfit(role: Role): boolean {
  return role === 'owner';
}

export function canVoidSale(role: Role): boolean {
  return role === 'owner';
}

export function canAccessRoute(role: Role, pathname: string): boolean {
  return role === 'owner' || pathname === '/' || pathname === '/pos';
}

export const STAFF_BLOCKED_MESSAGE = 'Staff mode: sales only. Ask the owner for prices, profit, or voids.';
