import { StrKey, xdr } from '@stellar/stellar-sdk';
import { showScVal, type ContractSpec } from './soroban-spec.js';

export interface ContractChange { contract: string; event: string; description: string; evidence: string }
// Field layouts from OpenZeppelin/stellar-contracts at 33b665bccb4f38c54f1bb3c5700d950b76e32e0b.
// Interfaces and emitted events are self-declarations, NOT implementation/audit identity.
const layouts = {
  RoleGranted: { topics: ['role', 'account'], data: ['caller'], types: ['scvSymbol', 'scvAddress', 'scvAddress'], action: 'reports granting a role' },
  RoleRevoked: { topics: ['role', 'account'], data: ['caller'], types: ['scvSymbol', 'scvAddress', 'scvAddress'], action: 'reports revoking a role' },
  RoleAdminChanged: { topics: ['role'], data: ['previous_admin_role', 'new_admin_role'], types: ['scvSymbol', 'scvSymbol', 'scvSymbol'], action: 'reports changing a role administrator' },
  AdminTransferCompleted: { topics: ['new_admin'], data: ['previous_admin'], types: ['scvAddress', 'scvAddress'], action: 'reports completing an administrator transfer' },
  OwnershipTransferCompleted: { topics: [], data: ['new_owner'], types: ['scvAddress'], action: 'reports completing an ownership transfer' },
  OwnershipRenounced: { topics: [], data: ['old_owner'], types: ['scvAddress'], action: 'reports renouncing ownership' },
  Paused: { topics: [], data: [], types: [], action: 'reports pausing the contract' },
  Unpaused: { topics: [], data: [], types: [], action: 'reports unpausing the contract' },
} as const;

/** Only committed successful events, with an interface read from hash-bound WASM. */
export function decodeContractChange(event: xdr.ContractEvent, spec: ContractSpec | undefined, succeeded: boolean): ContractChange | undefined {
  if (!succeeded || spec?.origin !== 'contract interface' || !/^[a-f0-9]{64}$/.test(spec.codeHash ?? '')) return undefined;
  try {
    if (event.type().name !== 'contract' || !event.contractId()) return undefined;
    const body = event.body().v0();
    const topics = body.topics();
    const definition = spec.events.find((candidate) => Object.hasOwn(layouts, candidate.name)
      && candidate.prefix.length > 0 && candidate.prefix.every((part, i) => topics[i]?.switch().name === 'scvSymbol' && topics[i]!.sym().toString() === part)
      && topics.length === candidate.prefix.length + candidate.topics.length);
    if (!definition) return undefined;
    const layout = layouts[definition.name as keyof typeof layouts];
    if (JSON.stringify(definition.topics) !== JSON.stringify(layout.topics) || JSON.stringify(definition.data) !== JSON.stringify(layout.data)) return undefined;
    let data: xdr.ScVal[];
    const raw = body.data();
    if (definition.format === 'map' && raw.switch().name === 'scvMap') {
      const entries = raw.map() ?? [];
      if (entries.length !== layout.data.length) return undefined;
      data = definition.data.map((name) => {
        const matches = entries.filter((entry) => entry.key().switch().name === 'scvSymbol' && entry.key().sym().toString() === name);
        if (matches.length !== 1) throw new Error('field mismatch');
        return matches[0]!.val();
      });
    } else if (definition.format === 'vec' && raw.switch().name === 'scvVec') data = raw.vec() ?? [];
    else if (definition.format === 'single' && layout.data.length === 1) data = [raw];
    else return undefined;
    if (data.length !== layout.data.length) return undefined;
    const values = [...topics.slice(definition.prefix.length), ...data];
    if (values.some((value, index) => value.switch().name !== layout.types[index])) return undefined;
    const fields = [...layout.topics, ...layout.data].map((name, i) => `${name}: ${showScVal(values[i]!)}`).join('; ');
    return { contract: StrKey.encodeContract(event.contractId() as unknown as Buffer), event: definition.name,
      description: `OpenZeppelin-compatible event ${layout.action}${fields ? ` (${fields})` : ''}.`,
      evidence: `Matched the emitting code's interface and event fields; code SHA-256 ${spec.codeHash}. Provider-reported execution, not independent state verification. Any contract can copy this interface: OpenZeppelin implementation, audit status, authorization and present state are not established.` };
  } catch { return undefined; }
}
