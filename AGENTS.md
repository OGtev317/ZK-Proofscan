# OtakuCoin project guidance

This is a new, independent project. Keep changes inside this checkout. Do not
modify, link to or copy code from another project (including OFFLINE /
OtakuOffline, Zanime / OtakuSpace, Zellar / Zatrix Wallet) unless the owner
explicitly asks for that specific reuse.

Read `docs/PROJECT_CHARTER.md` and `docs/HANDOFF.md` and inspect Git status
before continuing. The charter records a proposed direction, not settled
requirements: confirm scope with the owner before choosing a language,
framework or wire format, and before building application features.

Do not disclose or commit secrets, private keys, seed phrases, API tokens,
account data or identity documents. Never copy credentials, environment files,
databases or runtime artifacts from other projects.

The name does not authorize a token. Repository creation and generic
continuation are not approval for token design or issuance, smart-contract
deployment, wallet actions, transaction signing, testnet or mainnet activity,
public RPC use, bridges, fees, settlement, hosted services, paid
infrastructure or external integrations. Each needs the owner's explicit,
specific approval.

State claims at the strength the evidence supports. In particular, do not
describe a Bluetooth, QR or NFC exchange as proof of distance or presence, a
vouch graph as Sybil prevention, or offline value transfer as double-spend
prevention. See the charter's "Claims that need care".

Work on one branch per task, stage named files only, and commit or push only
when the owner asks.
