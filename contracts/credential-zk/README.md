<!--
  This file is part of the Atlantis `midnight-nft` foundation.
  Copyright (C) 2025-2026 Midnight Foundation
  SPDX-License-Identifier: Apache-2.0
-->

# Credential-ZK Contract

A privacy-preserving **soulbound credential** primitive for the Midnight blockchain, written in the
Compact language. A credential is an attestation **bound to one holder with no interface to move it**
(no transfer circuit) — think KYC/sanctions attestations, education credentials, named-attendee tickets,
proof-of-personhood, or DAO membership. Ownership is a holder-built **hiding commitment**, never a public
address, and a holder can prove possession **without revealing who they are, which credential they hold,
or whether it sits near any revoked one**.

This is the reference implementation for **MIP-A** — see
[MIP-A-soulbound-credential-primitive.md](./MIP-A-soulbound-credential-primitive.md) for the normative
specification, and [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the honest caveat list.

> For the transferable private-NFT sibling, see [nft-zk](../nft-zk/).

## Structure

```
contracts/credential-zk/
├── src/
│   ├── credential-zk.compact         # The contract (single file — see design note below)
│   ├── witnesses.ts                  # TypeScript witness definitions (issuer + holder roles)
│   └── test/
│       ├── credential-zk-simulator.ts  # In-process contract simulator
│       └── credential-zk.test.ts       # Test suite (28 tests, incl. adversarial cases)
├── MIP-A-soulbound-credential-primitive.md
├── KNOWN_LIMITATIONS.md
└── README.md
```

**Why one file (no sub-module):** the ledger ADTs (`issuedCredentials`, `revokedSet`) must be declared
at the **top level** — Compact only surfaces top-level `ledger` fields in the generated TypeScript
`Ledger` accessor (with `pathForLeaf` / `findPathForLeaf` / `firstFree`). Module-declared ledgers are not
surfaced, which would make the off-chain Merkle-path construction the holder proofs require impossible.

## Design model

- **Secret-derived issuer authority.** Authorization never uses `ownPublicKey()` (a spoofable
  prover-supplied witness). Only the derived issuer **public** key is on-chain; every privileged circuit
  proves *knowledge of the issuer secret* (`issuer == deriveIssuerPk(issuerSecretKey())`).
- **Rotation-invariant namespace.** The credential namespace is derived from the **initial** issuer +
  `schemaId` + `deploymentSalt`, so rotating the issuer does **not** invalidate already-issued credentials.
- **Hiding commitments.** The holder builds the credential commitment off-chain with `persistentCommit`
  and hands the issuer only the opaque `cm`. Two credentials for the same holder are distinct on-chain
  leaves (different nonce + handle), so holdings can't be grouped.
- **Private non-revocation via an Indexed Merkle Tree (IMT).** A holder proves their revocation handle is
  **not** in the revoked set by *bracketing* it between two sorted neighbours — without disclosing the
  handle or which gap it occupies. Membership uses a `HistoricMerkleTree` (in-flight proofs survive new
  issuance); the revoked set is a plain `MerkleTree` checked against the **current** root (a since-revoked
  holder cannot anchor to a stale root).
- **Soulbound by construction.** There is no transfer circuit and the commitment binds the holder's
  key + secret; ownership cannot move without re-issuance by the issuer.

### Profiles

The same commitment shape carries a profile tag:

- **Wallet** (`mipa:cred:wallet:v1`, default) — presentation additionally proves the holder controls the
  key behind `holderPk` (`holderPk == deriveUserPk(holderIdentitySecret)`). Resists *casual* sharing.
- **Bearer** (`mipa:cred:bearer:v1`) — no identity check; whoever holds the opening can present.

## Circuits

| Circuit | Description |
|---|---|
| `issue(cm)` | **Issuer-only.** Insert a holder-built opaque commitment into `issuedCredentials`. |
| `revoke(handle, lowValue, lowNext)` | **Issuer-only.** Splice `handle` into the revoked IMT; the splice index is derived from the proven predecessor path, not a free parameter. |
| `proposeIssuer(newIssuerPk)` | **Issuer-only.** Step 1 of the hardened two-step rotation. |
| `acceptIssuer()` | Step 2 — the new issuer accepts by proving knowledge of the new secret (authority can never rotate to an unprovable key). |
| `provePresentation(verifierChallenge)` | Holder proof: one bound proof of *issued* **and** *not-revoked* over a single opening (plus holder-identity for the wallet profile). Returns a challenge-bound presentation nullifier. |
| `buildCredentialCommitment(...)` | Pure helper — the normative `mipa:cred:v1` hiding commitment (built off-chain by the holder). |
| `deriveIssuerPk(sk)` / `deriveUserPk(secret)` | Pure key-derivation helpers (domain-separated). |
| `walletProfileTag()` / `bearerProfileTag()` / `revLeafHash(value, next)` | Pure tag / IMT-leaf helpers. |

Constructor: `constructor(domain, schemaId, deploymentSalt)` — derives + stores the initial issuer, seals
the namespace and credential domain, and plants the IMT `(0,0)` sentinel. **The deployer MUST supply a
fresh, unique `deploymentSalt` per deployment** (see KNOWN_LIMITATIONS).

### One instance = one credential class (normative)

`credentialDomain` and the issuer namespace are **sealed at deployment**, so **each credential class
(e.g. KYC vs proof-of-personhood vs DAO membership) is a separate contract deployment.** A wallet/verifier
flow is scoped to a single deployed instance.

## Running tests

```bash
# From repo root — compile contracts (incl. credential-zk) then run tests
yarn test:compile

# If contracts are already compiled
yarn test
```

Compiled with `compactc 0.31.0` / language `0.23.0` (`pragma language_version >= 0.23`). On Windows note
that `compact` may collide with the built-in `C:\Windows\System32\compact.exe`; ensure the Compact
toolchain resolves first.

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
