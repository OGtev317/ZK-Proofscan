import type { Curve, Protocol } from './importer.js';

// Fixed wording for a proof checked against a key the user supplied. It
// describes what any such proof establishes and is the same for every
// circuit, because no circuit is known here. It is a draft: no qualified
// person has reviewed it.

export const SYSTEM_NAME: Record<Protocol, string> = { groth16: 'Groth16', plonk: 'PLONK', fflonk: 'FFLONK', ultrahonk: 'UltraHonk' };
export const CURVE_NAME: Record<Curve, string> = { bn128: 'BN254', bls12381: 'BLS12-381' };

const CLAIM = 'Whoever made this proof knew private inputs that, together with the public inputs below, satisfy the circuit this verification key was made for.';

export const SUPPLIED_KEY = {
  /** `recognised`: the key is an exact match to one in this tool's registry. */
  claim: (recognised: boolean): string =>
    recognised
      ? `${CLAIM} The key is recorded as belonging to the circuit named under "Verification key". This report does not explain what that circuit checks.`
      : `${CLAIM} This tool does not know what that circuit checks.`,
  hidden: ['The private inputs.'],
  publicNote: 'What each public input means depends on the circuit, which this tool does not know.',
  review: 'General wording for any circuit. No circuit was examined, and no qualified person has reviewed this wording.',
  /** `legacy`: checked with Barretenberg 0.87.0, the older verifier kept for proofs a current one does not read. */
  limits(protocol: Protocol, recognised: boolean, legacy = false): string[] {
    return [recognised ? RECOGNISED_KEY : UNKNOWN_KEY, ...GENERAL_LIMITS, ...(protocol === 'fflonk' ? [FFLONK_INV] : []), ...(protocol === 'ultrahonk' ? [ULTRAHONK_VERSION] : []), ...(legacy ? LEGACY_ULTRAHONK : [])];
  },
  assumptions(protocol: Protocol, curve: Curve): string[] {
    return [
      `The ${SYSTEM_NAME[protocol]} proof system and the ${CURVE_NAME[curve]} curve are sound.`,
      protocol === 'groth16'
        ? 'The trusted setup that produced this verification key, which is specific to its circuit, was performed honestly.'
        : 'The trusted setup behind this verification key, which is shared between circuits, was performed honestly.',
      'The verifier library is correct.',
    ];
  },
} as const;

const ULTRAHONK_VERSION =
  'UltraHonk proofs and keys change between versions of Barretenberg. A proof made with another version may fail here without being wrong, and this tool cannot tell which version made a proof.';

// Barretenberg 0.87.0 is kept for the proofs Nethermind's UltraHonk verifier
// for Stellar is built for. Measured on it: a number written above the field
// size, and the last point of a proof written with its halves split another
// way, both still verify. This tool refuses those two before verifying.
const LEGACY_ULTRAHONK = [
  'This proof was checked with Barretenberg 0.87.0, an older version kept for proofs that a current version does not read. Fixes made to Barretenberg since that version are not in it.',
  'A pass here does not show that a contract would accept this proof. A verifier written for a chain, such as the UltraHonk verifier for Stellar, is separate code with its own rules, and may refuse a proof that passes here.',
  'The bytes of a proof do not identify it. Whoever made this proof can make other proof files for the same statement, so two different files can be the same claim.',
];

// Measured: snarkjs 0.7.6 accepts an FFLONK proof whatever "inv" holds.
const FFLONK_INV =
  'The verifier used here does not read one value in an FFLONK proof, named "inv", which other verifiers such as a generated Solidity contract use. Such a verifier may reject a proof that passes here.';

const UNKNOWN_KEY =
  'The verification key was supplied with the proof, and this tool does not know where it came from. A key can be made for a circuit that accepts anything. This result means something only if you got the key, or its SHA-256, from a source you trust that is separate from whoever gave you the proof.';
// A match says which recorded file the key is. Everything else about that
// file is stated separately and is not improved by the match.
const RECOGNISED_KEY =
  'The verification key is an exact match to a recorded key. That shows which published key it is. How far that key is tied to circuit source, whether anyone checked the record, and whether its explanation was reviewed are each stated under "Verification key", and the match adds nothing to them.';

const GENERAL_LIMITS = [
    'This does not establish what the circuit checks, so it does not establish what the public inputs mean or that any statement about the world is true.',
    'This does not establish who made the proof, that whoever presents it made it, or that it has not been presented before.',
];
