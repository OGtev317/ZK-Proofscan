# Akashi / ZK-Proofscan hosting notes

The separate submission page was removed at the owner's request on 2026-10-12.
The actual browser proof checker is the only page, at https://akashi.zatrix.xyz/.
Earlier submission-page source remains recoverable in Git history.

The root app has valid and tampered Semaphore v4 sample buttons. Both use the
same worker, pinned artifacts, and verifier as uploaded proofs. The fixture
was generated from throwaway identities; it contains no secret witness values.
Choosing a sample clears previously selected public-input/key files to avoid
accidentally checking it against another circuit. Verification and report
wording are unchanged. No account, wallet, analytics, or proof-upload service
was introduced. This is a public testing prototype, not an audited release.

## Hosting

- Public URL: https://akashi.zatrix.xyz/
- Sites origin: https://akashi-otakulabz.finecorgi5.chatgpt.site
- Access: public, explicitly approved by the owner.
- Project: `appgprj_6acc5d97b79c8191b41062a48ea5d8c6`
- Custom domain: `appgdom_6acd044845508191967aaa17a9a2a7cd`
- Publication checkout: `build/site-publication/` (ignored by the app repo).
- The parent `zatrix.xyz` DNS records are unchanged.

Reuse this project, not a new Site. Build with `npm run build:web`; publish the
fresh `dist-web` output as the publication checkout's `dist` directory. Replace
the old directory rather than overlaying it, so removed pages and old assets
are not shipped. Use the Sites source helper, save, and public deploy workflow.
Do not copy uncommitted research or private runtime files into the publication.

For a local preview: `npx vite preview --host 127.0.0.1 --port 4318 --strictPort`.
GitHub commits/pushes for this work use `feat/public-proofscan-testing`; main
is not implicitly merged. Deployment IDs and live validation are recorded in
the delivery message. The earlier page is recoverable from commit `3d21415`.
