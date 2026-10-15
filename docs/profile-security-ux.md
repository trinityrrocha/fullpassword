# Profile security UX — development handoff

Base: `0784ee95800bfe65b650579a798629c6d0e1f289` (`main`).
Branch: `feature/profile-security-ux`. No merge or deployment is part of this change.

## Profile

Order: editable name, readonly email with Alterar, two password action cards,
MFA, navigation preferences, active sessions. The action cards stack on mobile.
Email uses the existing pending-change/code confirmation endpoints; login
password uses the existing profile endpoint and reauthentication grants. Both
end the session after confirmation. Forced temporary-password change opens
the mandatory password form directly. Existing MFA/recovery/session controls
remain available. Current profile MFA status is passed to the password dialogs
so enabling/disabling MFA does not require a page reload to update the fields.

Legacy login-password rewrap was extracted to `profilePasswordService.js`.
The v2 login-password path never sends or modifies `crypto_identity`.
No administrative vault-secret reset/recovery was introduced.

## Independent unlock-secret change

The current/new/confirmation unlock values exist only in DOM controls and local
transient variables. No React state/context, persistent storage, API payload,
URL or log receives them. Login password is separately requested and used for
the existing backend reauth and a local inequality comparison. This is a capture
variant of the existing purpose/action/session-bound mechanism, not a second
authentication implementation. Existing ReauthDialog remains the global fallback.

`rewrapIndependentIdentityUnlock` validates version/fingerprint, decrypts only
the personal Master Key wrapper, generates a fresh 32-byte salt, derives the
current PBKDF2-SHA256/600000 KEK and wraps the exact same 32-byte personal MK.
Transient MK bytes are zeroed in finally. Operational keys are nonextractable.
No RSA pair, DEK, vault envelope or encrypted record is regenerated.

`PUT /api/crypto/identity/unlock-secret` accepts exactly:

- `expectedIdentityHash` (canonical JSON SHA-256 of the original identity);
- `kdf`, `salt`, `wrappedMasterKey`;
- the existing one-time `_reauth_token`.

The transaction locks the authenticated user's row, checks CAS, validates exact
KDF/envelope sizes and consumes the action/session/purpose-bound grant. JSONB
updates only the three mutable fields; all other values, including future
fields, are preserved server-side. There is no target-user parameter or admin
override. Stale input returns 409 `CRYPTO_IDENTITY_CHANGED`, never overwrite.
Global CSRF, vault write limits, shared sensitive-attempt budget and existing
reauth/TOTP limits remain enforced. No new migration is required.

Audit action `crypto_unlock_secret_changed` stores only `{version: 2}` metadata
plus the existing actor/operational columns, in the same transaction. Neither
wrapper nor ciphertext nor secrets are logged by the new controller.

Success runs vault-lock cleanups/clipboard clearing, removes master/identity
keys, increments the vault generation/epoch, closes profile and displays the
requested success message. Every later v2 unlock fetches the current identity;
a generation check prevents an old asynchronous unlock from restoring keys
after a lock/logout/change. This does not revoke already known DEKs in another
unlocked tab: changing an unlock wrapper is not vault-key rotation.

## Shared dialog and Team

`FormDialog` owns positioned stacking, body scrolling, persistent footer,
focus trap/restoration, inert background, Escape and unsaved-change confirmation.
Cleanup is registered as a stack so nested unmount order cannot leave root inert.
Main/child/reauth layers retain the existing 50/60/100 scale.
Successful session-ending operations synchronously clean up dialog guards before
the existing logout/navigation. Successful profile save does not warn on reload.

Create/edit member dialogs consume this same owner. All prior fields, role/MFA/
group/status/delete rules and API payloads remain. Create-user copy now describes
login-only initial password and a separate vault secret chosen by its owner.
Group selection is an inline checkbox disclosure with bounded scrolling, avoiding
overflow clipping and incomplete listbox semantics. Outside-click collapse occurs
after click, not mousedown, preventing a moving footer from swallowing clicks.
The access-level select intentionally remains native/platform-owned.
Native Team alerts/confirms were replaced with inline feedback/app-owned dialogs.

## Verification and limits

Automated tests use synthetic accounts/data exclusively:

- `npm ci`, `npm test`, frontend production build and global ESLint;
- `node frontend/scripts/test-identity-unlock-change.js`: immutable identity,
  archive, same vault envelope/old record, old secret rejected/new accepted,
  invalid secret/version/fingerprint, nonextractable keys, no unlock values in
  captured API actions; v2 login invariance and legacy login rewrap;
- backend identity/crypto-parameter regression tests;
- `npm --prefix backend run test:identity-unlock`: native disposable PostgreSQL
  and actual HTTP/auth/CSRF/reauth/MFA/CAS/JSONB/audit, session invalidation and
  real rate limiting. The test never accepts a remote DB URL;
- isolated Playwright: actual profile/team/child components and CSS, mocked API
  with external requests blocked. Email confirmation/logout, forced password
  change, error handling, local crypto export, cleanup, name/preferences save,
  create/edit member payloads and duplicate-submit guard. Matrix 1280x800,
  390x850, 320x850, light/dark; programmatic hit tests catch backdrop interception,
  bounds/scroll/footer/group access and keyboard containment. Screenshots supplement
  assertions; they are not the only evidence;
- strict static audit on the changed dialog surface, DESIGN.md lint and secret/
  restricted-path/diff review.

The first attempt to append the new HTTP cases to the legacy integrated suite
exhausted real sensitive-operation limits. The cases now run in a fresh process
and disposable PostgreSQL instance, including an assertion that the sixth reauth
is rate-limited. No production limiter was weakened or test bypass added.
The full-project UI static scan times out on legacy code; focused audit is not
a claim of global UI compliance. Existing large-bundle and orphan-token warnings
are documented, not hidden by configuration changes.

No VM, real installation, operational policy/approval/catalog, release-agent,
WebUpdate, deployment Docker or backup implementation was accessed/modified.
No new schema migration. Local/isolated validation is not deployment validation.
Physical mobile keyboards, assistive technologies and real SMTP delivery remain
manual validation after a separately authorized deployment.
