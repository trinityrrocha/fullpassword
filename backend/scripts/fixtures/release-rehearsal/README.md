# Immutable historical release build fixtures

Exclusive to `test-release-upgrade-docker.js`; not application dependencies.

BASE: `d9a7a3786143379df43ff1910263894df33449bf`.
BOOTSTRAP: `821efb2659974b9a96ab7947dc07f988038042a5`.
Previous successful rehearsal: run `38651541241`.
Diagnostic run: `38773651868`, commit `4a2501c8b54f9017ac84c8a158e3cade56abe848`.

## Proven failure

`historical-base-backend` completed. `historical-base-frontend` failed, exit 1,
in its compound install instruction with npm 10.8.2:

```text
npm error Cannot read properties of null (reading 'edgesOut')
```

Neither BASE service has a committed package-lock.json. The frontend therefore
executes the `npm install` branch, not npm ci. Classification: NPM / floating
historical dependency resolution. This evidence does not prove a Docker tag
changed or a registry/network failure; those are not asserted as causes.

## Build-only adaptation

The original archived Dockerfiles, manifests and application code are not edited.
Generated Dockerfiles live beside, not inside, the archived contexts. A named
BuildKit context supplies only a fixture lock into the image build directory.

- BASE backend: same Node 20 base resolved in the diagnostic run, now pinned to
  `sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293`.
- BASE frontend builder: known Node 24.21.0/npm toolchain from the immutable
  BOOTSTRAP Dockerfile, pinned to
  `sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44`.
  This changes only the toolchain producing the static frontend, not its code.
- BASE frontend runtime: exact nginx digest resolved by the diagnostic run,
  `sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d`.
- Both BASE installs use npm ci with committed, integrity-checked fixture locks.
  No application manifest range/override was changed. No current app dependency
  was changed to fix this historical build.
- BOOTSTRAP already has pinned bases and lockfiles; it is not adapted.

The two fixture manifests retain the exact historical JSON values. Locks were
generated once using Node 24.19.0 / npm 11.18.0, with
`npm install --package-lock-only --ignore-scripts --no-audit --no-fund`.
Updating them is an explicit fixture change, not runtime resolution of latest.
All registry packages require SHA-512 integrity and public npm registry URLs.

The rehearsal still verifies the BASE revision in health, old schema/data,
bootstrap, current candidate, WebUpdate, 60-second stabilization, PostgreSQL
continuity/--no-deps, replay, controlled failure, rollback, second-volume recovery
and recovered login. A regression test compares this entire safety section to
the original PR head byte-for-byte after line-ending normalization.

This is not an offline or bit-for-bit image reproducibility claim: registry
availability and the historical backend APK repository remain external inputs.
No VM, existing database/volume or operational release policy is used.
