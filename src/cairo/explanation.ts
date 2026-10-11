import type { CairoParameters } from './verify.js';

// Fixed wording for a Cairo proof. The program is known only by its hash, so
// the wording is the same for every program. It is a draft: no qualified
// person has reviewed it.
export const CAIRO = {
  claim: 'A Cairo program with the hash shown ran from start to finish and wrote the output shown. This tool does not know what that program does.',
  hidden: ["The program's inputs, and everything it computed that is not in its output."],
  publicNote: 'What the output means depends on the program, which this tool does not know.',
  review: 'General wording for any Cairo program. No program was examined, and no qualified person has reviewed this wording.',
  limits: [
    'This does not establish what the program does, so it does not establish what the output means or that any statement about the world is true. A program hash tells you which program ran only if you have that program and compute its hash yourself.',
    'This is not a statement about Starknet. It does not show that anything happened on that network, that a transaction was included, or what any contract holds.',
    'This reads proofs in the layout of the Stone prover. Proofs from the newer S-two prover have a different layout, which this tool does not read.',
    'This does not establish who made the proof, that whoever presents it made it, or that it has not been presented before.',
  ],
  assumptions(parameters: CairoParameters): string[] {
    return [
      `STARK proofs with these parameters give the ${parameters.securityBits} bits of security the proof declares. That figure rests on a conjecture about the proof system, not on a proof.`,
      'The hash functions the proof uses behave as intended.',
      'The verifier library is correct. This tool knows of no audit of it.',
    ];
  },
} as const;
