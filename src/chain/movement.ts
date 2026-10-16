import type { Movement } from './stellar-activity.js';

const I128_MAX = (1n << 127n) - 1n;
const STROOPS = 10_000_000n;
/** Pure formatting; does not load the Stellar SDK into the initial page. */
export function stellarAmount(amount: bigint, asset: Movement['asset']): string {
  if (asset.kind === 'contract') return `${amount} of the smallest units of the token at ${asset.contract}`;
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const fraction = (value % STROOPS).toString().padStart(7, '0').replace(/0+$/, '');
  const units = `${negative ? '-' : ''}${value / STROOPS}${fraction === '' ? '' : `.${fraction}`}`;
  return asset.kind === 'native' ? `${units} XLM` : `${units} ${asset.code} (issued by ${asset.issuer})`;
}

export function describeMovement(movement: Movement): string {
  const amount = stellarAmount(movement.amount, movement.asset);
  switch (movement.kind) {
    case 'transfer': return `moved ${amount} from ${movement.from} to ${movement.to}`;
    case 'mint': return `created ${amount} for ${movement.to}`;
    case 'burn': return `destroyed ${amount} held by ${movement.from}`;
    case 'clawback': return `clawed back ${amount} from ${movement.from}`;
    case 'approve': return movement.amount >= I128_MAX >> 1n
      ? `allowed ${movement.to} to spend an UNLIMITED amount of ${amount.replace(/^\S+ /, '')} belonging to ${movement.from}, until ledger ${movement.until}, which lets it move all of it until then`
      : `allowed ${movement.to} to spend up to ${amount} belonging to ${movement.from}, until ledger ${movement.until}`;
  }
}
