<!--
  This file is part of the Atlantis `midnight-nft` foundation.
  Copyright (C) 2025-2026 Midnight Foundation
  SPDX-License-Identifier: Apache-2.0
-->

# Credential-ZK (MIP-A) — Known Limitations

Status: **v3 reference implementation. Compile-verified (compactc 0.31.0 / language 0.23.0) with 28
in-process tests including adversarial cases.** The core state machine is sound: secret-derived issuer
authority, holder-built hiding commitments, a single bound presentation (issued ∧ not-revoked over one
opening), a path-derived revoke index, and a two-step rotation that cannot brick authority. The items
below are logged honestly so nobody mistakes the current state for "finished." Cross-refs: the normative
[MIP](./MIP-A-soulbound-credential-primitive.md) (Security Considerations) and review
[issue #2](https://github.com/DpacJones/midnight-nft/issues/2).

## Verified / by design

- **Secret-derived issuer auth.** `ownPublicKey()` is never used for authorization; every privileged
  circuit asserts `issuer == deriveIssuerPk(issuerSecretKey())`. Reading the on-chain issuer public key
  does not let an attacker satisfy the gate.
- **Single bound presentation (H1).** Membership and non-revocation are proven over the **same** opening
  in one circuit, so the "prove issued with the real handle, prove not-revoked with a fake handle" bypass
  is structurally impossible.
- **Path-derived revoke index (H2).** The IMT splice targets the bracketing predecessor whose index is
  *derived from the proven path's direction bits*, so a caller cannot pass an unconstrained index that
  corrupts the tree.
- **Historic membership vs current-root revocation.** `issuedCredentials` is a `HistoricMerkleTree`
  (in-flight proofs survive new issuance); `revokedSet` is checked against the **current** root only
  (a since-revoked holder cannot anchor to a stale pre-revocation root).
- **Two-step rotation.** Authority can never rotate to a key nobody can prove.
- **Handle 0 reserved.** `handle == 0` is the IMT `(0,0)` sentinel — structurally unrevokable and
  unpresentable; `revoke` and `provePresentation` both reject it.

## Known limitations (none silently hidden)

- **Single-secret issuer authority.** Whoever holds the issuer secret is the issuer; a leak ⇒ compromise
  until rotated. The two-step rotation prevents *bricking*, but a true multi-party authority (M-of-N)
  needs Schnorr-in-circuit and is **out of scope for v1**.
- **`deploymentSalt` is load-bearing.** Per-instance namespace separation depends entirely on the deployer
  supplying a fresh, unique salt; reusing a salt across deployments with the same issuer + schema collapses
  their namespaces and re-enables cross-instance commitment confusion. `kernel.self()` cannot substitute —
  it is unavailable (resolves to a dummy/zero address) during constructor execution.
- **Opaque issuance.** `issue(cm)` receives only the opaque commitment; it **cannot** validate the
  commitment's well-formedness or uniqueness. Junk/duplicate leaves are unpresentable but still consume a
  slot in `issuedCredentials`. Issuers MUST only issue out-of-band-vetted `mipa:cred:*:v1` commitments
  carrying a **unique, non-zero** handle. *Open design point (see issue #2):* reconciling "the issuer never
  holds the opening" with "the issuer must vet well-formedness/uniqueness and know the handle to revoke" —
  the cleanest fix is a future **holder-proven issuance** circuit (holder proves in ZK that `cm` is
  well-formed with a unique non-zero handle, so the issuer authorizes without learning the opening).
- **Holder delegation / casual sharing.** The wallet profile binds `holderPk = deriveUserPk(holderIdentitySecret)`
  and so resists *casual* sharing, but a willing holder can still delegate by sharing their secrets. Full
  non-delegation needs hardware-bound keys / a Schnorr challenge — **out of scope for v1**. The bearer
  profile is intentionally shareable.
- **Replay / nullifier is verifier-side.** `provePresentation` *returns* a nullifier; it does not record
  it on-chain (this is a presentation, not a spend). A verifier MUST (1) issue a fresh, audience-bound
  `verifierChallenge` per presentation and (2) persist accepted nullifiers and reject repeats — otherwise
  a captured proof is replayable within the challenge window. One-time-use semantics would need a verifier
  store or a future on-chain nullifier `Set`.
- **Presentation liveness under revocation churn.** Because non-revocation is checked against the
  **current** `revokedSet` root, *any* `revoke` (even of an unrelated handle) landing between a holder's
  proof generation and submission changes the root and causes the presentation tx to be rejected — the
  holder must rebuild the path and reprove. This is the cost of the (deliberate) stale-root protection.
- **Correlation is not fully prevented.** Commitments carry no deterministic public holder id (no direct
  cryptographic linkage), but issuance/presentation **timing**, issuer off-chain records, and other
  metadata can still correlate. The anonymity set is all handles not otherwise linked to a holder — not a
  guarantee against metadata correlation. `revoke`'s `lowValue`/`lowNext` bracket args are public; UIs
  should treat them as operational metadata and avoid surfacing them in a way that invites handle↔holder
  mapping.
- **Handle generation is a holder/issuer responsibility.** `revocationHandle` MUST be drawn uniformly at
  random from `[1, 2^248)`; uniqueness across a class is enforced only by issuer off-chain policy.
- **Off-chain index bookkeeping (integration).** Holder proofs use `pathForLeaf(index, leaf)` because the
  find-by-value variant is unusable (the on-chain runtime tree is not auto-rehashed). A real wallet must
  therefore track its own leaf index in `issuedCredentials` off-chain.

## Pending for "Path to Active"

- **Public-testnet deployment** — verified in-process (simulator) only; a real-chain harness
  (issue → present → revoke with real ZK proofs, à la `nft-zk`'s `harness/midnight`) is not yet present.
- **Conformance vectors** — the MIP requires positive/negative `mipa:cred:v1` vectors to accompany the
  reference implementation; not yet published (should be generated from the compiled contract).
- **Companion MIPs** — higher-level disclosure-proof composition / selective attribute disclosure
  (Stage 2) and holder credential recovery/rotation (Stage 3) are out of scope for this primitive.
