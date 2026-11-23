# Contributing to Facet

Thank you for your interest in contributing to **Facet**! Facet is an Apache-2.0 open-source, local-first isolated browser profile and account manager.

## Development Workflow

1. Fork the repository and create a feature branch from `main`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run checks before opening a Pull Request:
   ```bash
   npm run typecheck
   npm run lint
   npm run test
   npm run test:integration
   npm run build
   npm run perf:budget
   ```
4. Follow `CLAUDE.md` engineering standards:
   - Strict TypeScript (`noUncheckedIndexedAccess: true`, **zero `any`**).
   - Typed IPC channels in `shared/ipc.ts` with Zod validation and sender frame checks.
   - Never commit real credentials, tokens, emails, proxies, or `vault.db` files.

## Strictly Out-of-Scope / Rejected Contributions

To keep Facet safe, compliant, and focused on legitimate local-first management, **Pull Requests implementing any of the following will be rejected**:

- **Email sending / bulk mailing:** Any feature requesting `gmail.send` or sending emails via Gmail API / SMTP.
- **Automated Google account creation:** Bulk signup, account farming, or automated phone/SMS verification.
- **CAPTCHA & verification bypass:** Any integration with CAPTCHA solvers, anti-bot bypasses, or Google security challenge circumvention.
- **Automated Google login / auto-fill:** Scripts or Playwright automation that auto-fill credentials or log into Google login pages on the user's behalf.
- **Anti-abuse evasion:** Features designed specifically to evade platform anti-fraud or anti-abuse systems.
- **Open / shared / rotating proxy abuse:** Open (unauthenticated) proxy mode, binding local IPv6 listeners outside `127.0.0.1` or sharing proxies across devices/users, per-request or per-connection IP rotation, scanning/using prefixes not owned by the user, or turning Facet into a proxy-reselling service.

Please review [docs/ACCEPTABLE_USE.md](docs/ACCEPTABLE_USE.md) before proposing new features.
