# 1. Use otplib for RFC 6238 TOTP compliance

* **Status**: ACCEPTED
* **Decision ID**: `dec-8d0be2fb`
* **Date**: 2026-08-19
* **Author**: `claude-code-worker-1` (agent)
* **Tags**: `auth`, `mfa`, `security`

## Context

Need reliable MFA token generation compatible with Google Authenticator

## Decision

otplib library with SHA-1 30-second step

## Rationale & Consequences

Well-maintained, standard compliance, zero extra native dependencies
