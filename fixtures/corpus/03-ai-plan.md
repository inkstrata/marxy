# Migration plan: auth service to passkeys

**Status:** draft 3 · **Owner:** platform team · **Generated:** 2026-09-17

## Summary

Replace password + TOTP with passkeys (WebAuthn) across web and mobile, keeping passwords as
a fallback for 90 days. Three phases, each behind a flag.

## Checklist

- [x] Threat model reviewed with security
- [x] WebAuthn relying-party ID agreed (`auth.example.com`)
- [ ] Attestation policy decided
  - [ ] Accept `none`
  - [ ] Log AAGUID for analytics (no telemetry to third parties)
- [ ] Recovery flow designed
- [ ] Mobile SDK spike (iOS 17+, Android 14+)
- [ ] Rollout flags created
  - [x] `passkeys.enroll`
  - [ ] `passkeys.require`

## Phases

| Phase | Scope | Exit criterion | Risk |
| --- | --- | --- | --- |
| 1 | Optional enrolment on web | 5 % of DAU enrolled | low |
| 2 | Enrolment on mobile; login prefers passkey | p95 login < 800 ms | medium |
| 3 | Passwords disabled for enrolled users | support tickets flat for 2 weeks | high |

## API changes

```http
POST /v2/webauthn/register/options
POST /v2/webauthn/register/verify
POST /v2/webauthn/login/options
POST /v2/webauthn/login/verify
```

```json
{
  "rp": { "id": "auth.example.com", "name": "Example" },
  "user": { "id": "b64url", "name": "ana@example.com", "displayName": "Ana" },
  "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }],
  "authenticatorSelection": { "residentKey": "preferred", "userVerification": "required" }
}
```

## Open questions

1. Do we support cross-device sign-in via QR on day one?
2. What happens to the 3 % of users on browsers without WebAuthn?
3. Should the `passkeys.require` flag be per-tenant?

## Rollback

```sh
flagctl set passkeys.require=false --all-tenants
flagctl set passkeys.enroll=false --all-tenants
```

Passwords remain valid throughout phase 1–2; phase 3 rollback re-enables them within one
deploy.
