# Key registry

`keys.json` lists verification keys this tool can recognise when one is
supplied with a proof. A match answers one question, "which published key
is this", and the report states everything else separately:

| Question | Field |
| --- | --- |
| Is the supplied key on record? | `keys[].contentSha256` |
| Where did the recorded file come from? | `provenance` |
| Is it tied to the circuit's source? | `circuitLink`: `established`, `partly-established` or `unconfirmed` |
| Has a maintainer checked this entry? | `entryReview` |
| Does this tool explain the circuit? | `explanationAdapter`; the adapter carries its own review status |

A key is identified by `contentSha256`: SHA-256 of the key with spacing
removed and fields in a fixed order, so the same key is recognised however
its file is laid out, and a key that differs in any value is not. One
published file can hold several keys; the file's own hash goes in
`provenance.sha256` and is never treated as a key.

## Changing it

1. Edit `keys.json`. Raise `revision`.
2. Put the file's new SHA-256 in `KEY_REGISTRY_SHA256` in `src/registry.ts`.
   A registry file with any other content is refused at start.
3. Add a test that derives each new `contentSha256` again from the pinned
   artifact, as `tests/registry.test.ts` does for Semaphore.
4. Set `entryReview` to `reviewed` only with the name of the maintainer who
   compared the entry with the publisher's release, and the date.

Do not add an entry from a file name, a user's description or an
unpublished key. Do not mark `circuitLink` as `established` without a
recorded check that reproduces the key from the circuit source and setup.
