# Temporary SCF submission-link compatibility

The owner confirmed on 2026-10-16 that the submitted SCF homepage link used
`/submission/`, and requested a temporary redirect to the current demo.

`web/public/submission/index.html` is copied into the static web build by Vite.
It immediately opens `../` (the current homepage), with no JavaScript required,
and provides a manual link. It contains no grant presentation, claims or form.
The homepage and existing integrations are unchanged.

This is an HTML/browser redirect served as HTTP 200 by GitHub Pages, **not** an
HTTP 302/307 or permanent 301 rule. No new hosting, DNS change or backend is used.
GitHub Pages may separately normalize `/submission` to `/submission/`.
The target is fixed; no query parameter can choose another destination. Query
strings and fragments are not forwarded, so old-link parameters cannot trigger
automatic shared-transaction lookups. No secrets or witness values belong in URLs.

The compatibility page supersedes the earlier instruction that this exact path
must return 404. It does not authorize restoring the previous grant microsite.
No expiration date was specified; leave the link working during SCF review until
the owner requests removal. Removal is just deleting the compatibility HTML and
its dedicated browser tests, then rebuilding and publishing through existing CI.

Browser coverage checks the exact submitted path with its trailing slash, its
explicit index file, fixed destination, no forwarded query/fragment, manual fallback
markup, and operation with JavaScript disabled. Vite's SPA preview does not emulate
GitHub Pages' slash normalization; check `/submission` separately after deployment.
Testnet/mainnet RPCs are not contacted by the local redirect checks.
