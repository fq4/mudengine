# Dependency audit

Audit performed on 2026-10-13 from the `development` branch (`d3941e3`).

## Result

The current `package-lock.json` produces no advisories:

```text
npm audit             0 vulnerabilities
npm audit --omit=dev  0 vulnerabilities
```

The install on the previous checkout reported 30 vulnerabilities (9 moderate,
18 high, 3 critical). That count is not reproducible with the current
development lockfile or npm advisory database, so there are no affected package
names, dependency chains, or CVE paths to remediate in this checkout. The npm
install output also included deprecation notices for transitive tooling packages
such as `glob`, `rimraf`, `inflight`, `npmlog`, `gauge`, and `tar`; deprecation is
not itself a vulnerability finding. `npm ls` confirms these remain in Electron
packaging/build tooling where applicable, not in the application's production
dependency set.

## Runtime assessment

The production graph (`npm audit --omit=dev`) is clean. Electron's packaged
runtime uses the direct application dependencies and the bundled Electron
runtime; the development-only build/test graph is not shipped as application
code. No currently reported advisory is exploitable in MudEngine's Electron
environment because no advisory is currently reported for either graph.

Several newer major versions are available (Electron, electron-vite, Vite,
Vitest, React, TypeScript, and xterm), but they are outside a security fix and
would require compatibility evaluation. They were intentionally not upgraded
as part of this audit. Patch updates offered by the registry likewise do not
address a reported advisory and are deferred to a focused dependency refresh.

## Follow-up

Repeat `npm ci`, `npm audit`, and `npm audit --omit=dev` in CI. If the advisory
database reports findings again, record the package, severity, advisory, and
`npm explain <package>` chain before changing versions. Prefer the smallest
compatible update; do not use `npm audit fix --force` or cross-major upgrades
without separate tests and review.
