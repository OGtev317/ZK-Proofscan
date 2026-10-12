// Fixed wording for a RISC Zero receipt. The program is known only by its
// image ID, so the wording is the same for every program. It is a draft: no
// qualified person has reviewed it.
export const RISC_ZERO = {
  claim: 'A program with the image ID shown ran in the RISC Zero virtual machine, stopped normally, and wrote a journal with the SHA-256 shown. This tool does not know what that program does.',
  hidden: ["The program's inputs, and everything it computed that is not in its journal.", 'The journal itself is not in this file. Only its SHA-256 is.'],
  publicNote: 'What the journal means depends on the program, which this tool does not know.',
  review: 'General wording for any RISC Zero program. No program was examined, and no qualified person has reviewed this wording.',
  limits: [
    'This does not establish what the program does, so it does not establish what the journal means or that any statement about the world is true. An image ID tells you which program ran only if you have that program, build it yourself and compute its image ID.',
    'This tool did not see the journal. To learn what the program wrote, get the journal from whoever made the proof and check that its SHA-256 is the one shown.',
    'This is not a statement about Stellar or any other network. It does not show that a contract accepted this proof, that a transaction was included, or what any contract holds.',
    'Only receipts made for version 3.0.0 of the verifier parameters are checked. A receipt from another RISC Zero version is reported as not checked.',
    'This does not establish who made the proof, that whoever presents it made it, or that it has not been presented before.',
  ],
  assumptions: [
    'Groth16 on the BN254 curve is sound.',
    "The trusted setup behind RISC Zero's verification key was run honestly by at least one participant. This tool did not examine it.",
    'The RISC Zero circuits that the control root in these parameters allows are sound. This tool takes the parameters as published and did not examine those circuits.',
    'The verifier implementation is correct.',
  ],
} as const;
