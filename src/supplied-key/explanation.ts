import type { Curve, Protocol } from './importer.js';

// Fixed wording for a proof checked against a key the user supplied. It
// describes what any such proof establishes and is the same for every
// circuit, because no circuit is known here. It is a draft: no qualified
// person has reviewed it.

export const SYSTEM_NAME: Record<Protocol, string> = { groth16: 'Groth16', plonk: 'PLONK', fflonk: 'FFLONK' };
export const CURVE_NAME: Record<Curve, string> = { bn128: 'BN254', bls12381: 'BLS12-381' };

export const SUPPLIED_KEY = {
  claim:
    'Whoever made this proof knew private inputs that, together with the public inputs below, satisfy the circuit this verification key was made for. This tool does not know what that circuit checks.',
  hidden: ['The private inputs.'],
  publicNote: 'What each public input means depends on the circuit, which this tool does not know.',
  review: 'General wording for any circuit. No circuit was examined, and no qualified person has reviewed this wording.',
  limits(protocol: Protocol): string[] {
    return [...GENERAL_LIMITS, ...(protocol === 'fflonk' ? [FFLONK_INV] : [])];
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

// Measured: snarkjs 0.7.6 accepts an FFLONK proof whatever "inv" holds.
const FFLONK_INV =
  'The verifier used here does not read one value in an FFLONK proof, named "inv", which other verifiers such as a generated Solidity contract use. Such a verifier may reject a proof that passes here.';

const GENERAL_LIMITS = [
    'The verification key was supplied with the proof, and this tool does not know where it came from. A key can be made for a circuit that accepts anything. This result means something only if you got the key, or its SHA-256, from a source you trust that is separate from whoever gave you the proof.',
    'This does not establish what the circuit checks, so it does not establish what the public inputs mean or that any statement about the world is true.',
    'This does not establish who made the proof, that whoever presents it made it, or that it has not been presented before.',
];
