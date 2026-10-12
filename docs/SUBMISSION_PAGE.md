# Akashi submission page

The local presentation page is at `/submission/`. The existing verifier remains
at `/`; its cryptography, wording, and interface are unchanged. Akashi is the
proposed presentation brand by OtakuLabz, developed as ZK-Proofscan.

Build with `npm run build:web`, then preview with
`npx vite preview --host 127.0.0.1 --port 4318 --strictPort`.
Open `http://127.0.0.1:4318/submission/`.

The static page has no JavaScript, remote fonts, analytics, wallet integration,
form, or automatic external requests. Its report diagram is explicitly an
illustration, not a computed verdict. It links to the working browser verifier.
Engineering figures are tied to main checkpoint `87a69c6`, not rolling counters.
GitHub evidence links require private-repository access.

On 2026-10-12 the owner approved publication and a commit. Publication is
handled through Sites using a separate build-only checkout, so unrelated
uncommitted research is never uploaded. GitHub visibility remains private.
This submission preview is not a claim of SCF acceptance or a production-ready
verifier. See the delivery message for the confirmed deployment URL and access.

## Publication checkpoint

Sites confirmed a successful deployment on 2026-10-12:

- Origin: https://akashi-otakulabz.finecorgi5.chatgpt.site
- Submission page: https://akashi-otakulabz.finecorgi5.chatgpt.site/submission/
- Access at publication: owner-private; public reviewer access awaits approval.
- Project: `appgprj_6acc5d97b79c8191b41062a48ea5d8c6`
- Deployment: `appgdep_6acc5dd6d9b88191a759f3d17ecd515f`
- App source: `3d2141571264898a8b702ada2c36c45f37b222fe`
- Published build source: `a5359624e7f5bd08e94ebb16cf46abfcdbd97fb5`
- Local publication checkout: `build/site-publication/` (ignored by the app repo).

Reuse this Sites project for subsequent updates; do not create a second Site.
The original GitHub repo remains private. Main was not merged or modified.

Validation on 2026-10-12: typecheck passed; production browser build passed;
all 30 Playwright tests passed on Chromium and WebKit (26 existing checks,
four new submission-page checks). Desktop and 375px-wide mobile screenshots
were visually inspected. Production dependency audit reported no known
vulnerabilities; the full dependency install reported 10 development-tree
advisories. No dependencies or lockfiles were changed. Unit tests were not
rerun for this presentation-only change.
