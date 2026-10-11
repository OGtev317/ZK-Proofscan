# OtakuCoin project charter

Created 2026-10-11. **Proposed direction, not settled requirements.** The
architecture below was supplied by the owner as a starting brief. Nothing here
is implemented, specified or approved for release.

## The idea

Build a protocol, not an app: a foundation other builders use whenever two
people or devices need to prove they met and exchanged something in person.
The brief calls it a "Physicality SDK" (or "Proximal Core") and compares it to
TCP/IP: it handles the proof of an encounter and does not care what the
application does with it.

## Proposed architecture: four optional layers

| Layer | Purpose | Proposed interface |
| --- | --- | --- |
| 1. Transport ("Handshake") | Run the BLE, QR or NFC exchange | `proximity.startDiscovery()`, `proximity.exchange(payload)` returning a `HandshakeReceipt` |
| 2. Identity and trust ("Vouch") | Keys and trust graphs | `identity.createProfile()`, `identity.vouch(peerID)`, `identity.verifyTrust(peerID, threshold)` |
| 3. State ("Gossip engine") | Store-and-forward spread of data between encounters | `gossip.broadcast(object)`, `gossip.listen(filter)`, `gossip.sync()` |
| 4. Bridge ("Anchor") | Push offline signed vouchers to a blockchain | `anchor.submit(voucher)`, `anchor.verifyOnChain(voucherID)` |

The shared unit is a **voucher**: a signed record of an encounter. The brief
suggests fields such as sender, receiver, timestamp, location hash and
signature.

## Example products the brief has in mind

| Product | Layers | What the builder adds |
| --- | --- | --- |
| Resource economy | Transport, Bridge | Item catalogue and payment amount |
| Mesh DAO | Transport, Identity, Gossip, Bridge | Voting logic and proposal text |
| Logistics escrow | Transport, Bridge | Job identifier and shipping address |
| Skill graph | Transport, Identity, Bridge | Skill categories |
| Evidence vault | Transport, Gossip, Bridge | Hashing of the photo or video file |

## Proposed business model

Open-source transport and identity layers; a paid hardened version with audits
and support for organisations; a small protocol fee on proofs anchored through
a bridge the project operates. None of this is decided or approved.

## Proposed first steps from the brief

1. Make the transport callable as a library by any code, not only one UI.
2. Standardise the voucher format.
3. Build three small reference apps (voting, payment, vouching).

## Claims that need care

The brief states several things more strongly than the technology supports.
These must be resolved in the specification, and until then must not appear in
documentation, marketing or code comments as facts.

1. **"Cryptographic proof that two devices were within 1 meter."** A BLE, QR
   or NFC exchange proves that two keys took part in an exchange over that
   channel. It does not prove distance. Bluetooth signal strength is not a
   measurement an attacker cannot fake, and every one of these channels can be
   relayed: a QR code can be shown over a video call, and BLE and NFC traffic
   can be forwarded between two distant accomplices. Bounding distance
   cryptographically needs secure ranging (for example ultra-wideband with
   distance bounding), which is hardware-dependent. An honest name for the
   Layer 1 output is a *mutually signed exchange receipt*.
2. **Sybil resistance.** One person can create many keys, and colluding
   people can vouch for each other. A vouch graph raises the cost of fake
   identities; it does not prevent them.
3. **Offline value transfer.** Two disconnected devices cannot prevent the
   same value being spent twice. The achievable property is detection after
   the fact, with proof of who did it and limits on what a receiver can lose.
4. **Location hash.** A hash of a location is easy to reverse by guessing
   nearby coordinates, and a signed, timestamped record of who met whom is
   sensitive on its own. Anything anchored publicly is permanent. Privacy has
   to be designed in before a voucher format is fixed.
5. **Gossip of "viral" data.** Epidemic spread to every encounter needs
   limits on size, lifetime and who may inject data, or any participant can
   flood the network.
6. **The name and the fee.** "Coin", a bridge fee and on-chain anchoring
   raise token, payment and regulatory questions. No token is designed,
   implied or approved by this charter. See `AGENTS.md`.

## Related work by the same owner

The separate OtakuOffline project (repository `OGtev317/OFFLINE`) already
contains TypeScript implementations of much of layers 1 to 3: BLE, WebRTC and
QR transports, key-based identity with in-person fingerprint verification,
store-and-forward custody with signed delivery receipts, and an opt-in relay.
It is unaudited evaluation code. Whether this project reuses, depends on or
stays independent of that code is an open decision for the owner; nothing has
been copied.

## Open decisions for the owner

1. Is the first deliverable the voucher specification, as the brief suggests?
2. Reuse OtakuOffline's core, depend on it, or start clean?
3. Which platforms and language first?
4. What may a voucher reveal, and to whom?
5. Is a blockchain bridge in scope at all for the first version, and if so
   which chain? This needs explicit approval before any work.
6. Is "OtakuCoin" the product name, given that no token is designed?
