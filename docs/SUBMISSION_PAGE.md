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

Validation on 2026-10-12: typecheck passed; production browser build passed;
all 30 Playwright tests passed on Chromium and WebKit (26 existing checks,
four new submission-page checks). Desktop and 375px-wide mobile screenshots
were visually inspected. Production dependency audit reported no known
vulnerabilities; the full dependency install reported 10 development-tree
advisories. No dependencies or lockfiles were changed. Unit tests were not
rerun for this presentation-only change.
