# ZK-Proofscan project guidance

This is a new, independent project. Keep changes inside this checkout. Do not
modify, link to or copy code from another project (including OFFLINE /
OtakuOffline, Zanime / OtakuSpace, Zellar / Zatrix Wallet, Zeero) unless the
owner explicitly asks for that specific reuse.

Read `docs/PROJECT_CHARTER.md` and `docs/HANDOFF.md` and inspect Git status
before continuing. The charter records a proposed direction, not settled
requirements: confirm scope with the owner before choosing a language,
framework, proof system or report format, and before building features.

Do not disclose or commit secrets, private keys, seed phrases, API tokens,
account data or identity documents. Never accept, log, store or commit private
witness values: the tool works from a proof, its public inputs and a verifying
key. Test fixtures must be generated from throwaway inputs. Never copy
credentials, environment files, databases or runtime artifacts from other
projects.

Repository creation and generic continuation are not approval for public RPC
use, on-chain reads or writes, wallet actions, transaction signing, testnet or
mainnet activity, contract deployment, tokens, fees, hosted services, paid
infrastructure or external integrations. Each needs the owner's explicit,
specific approval. Until then the tool verifies supplied files offline.

Do not write a proof verifier or other cryptographic primitive here. Use an
established, maintained library and record its version and audit status.

State claims at the strength the evidence supports. A report must never say
more than the circuit enforces: do not describe a passing proof as showing the
statement is true in the world, a membership proof as unique personhood, or an
unreviewed circuit as having a known meaning. See the charter's "Claims that
need care".

Work on one branch per task, stage named files only, and commit or push only
when the owner asks.
