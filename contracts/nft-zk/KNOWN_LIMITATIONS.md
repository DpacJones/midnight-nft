# NftZk (claim-model) — Known Limitations

Status: **v1.1 foundation. Both contract-level mainnet blockers are now fixed; the one remaining blocker is infrastructure, not contract.** The ownership/transfer state machine is sound (no duplication/loss, no stranger front-running, correct domain separation, claim auth anchored to the unforgeable `ownPublicKey()`); ownership is unlinkable across a user's tokens; the admin is a real key. Items below are logged honestly per the Engine Honesty Posture.

## Addressed in v1.1

- **H2 — Ownership linkability — FIXED.** Owner commitment folds `tokenId` in: `persistentHash(["nftzk:owner:v1", pubkey, local_secret, tokenId])` → each token gets a distinct on-chain commitment; a user's holdings can no longer be grouped by their stored owner value. (Regression test in suite.)
- **M1 — Admin is now a real, tx-authenticated key — FIXED.** `contractAdmin` stores the admin's `ownPublicKey().bytes`; `mintAdmin`/`rotateAdmin` assert `ownPublicKey().bytes == contractAdmin` (unforgeable — the ledger verifies the tx signature). No shared secret to leak; `rotateAdmin` hands off to a new key. **Tradeoff (accepted):** the admin's public key is now visible on-chain (the prior design hid it behind a hash but was only a shared password). Fine for an operational/treasury role. A fully *private* admin would need Schnorr-in-circuit (proving knowledge of a key behind a committed pubkey) — deferred; only worth it if admin anonymity becomes a requirement.
- **On-chain `balanceOf` removed** — a stable per-user count key was itself a leak; balance/enumeration is an offline/wallet concern.
- **H3 — Counter underflow** — moot (counter removed).

## Remaining blocker before value-bearing / mainnet (INFRASTRUCTURE, not contract)

- **M2 — Claim-tx submitter visibility.** A direct, un-relayed `claim`/`release`/`burn` transaction is authenticated by the caller's public key at the ledger/fee layer, so an observer of raw txs can link that single token to the caller's ledger identity at the moment they act. The contract cannot hide network-level submitter/fee-payer metadata. **Full end-to-end anonymity requires a relayer system or ledger-level fee shielding** — a separate infra track. Until then, treat on-chain actions as identity-revealing at the tx layer.

## Usage requirements / lower-severity

- **Use a fresh `claim_salt` per claim.** The claim commitment is `persistentHash(["nftzk:claim:v1", recipient_pubkey, claim_salt])`. Reusing one salt makes two pending claims to the same recipient share an on-chain commitment → linkable *during the pending window*. Wallets must generate a fresh salt per incoming transfer. (Post-claim ownership is unlinkable via H2.)
- **C2 — The claim salt is privacy, not theft protection.** Claim auth is anchored to the recipient's unforgeable pubkey; the salt only provides unlinkability.
- **H1 — Releasing to a malformed commitment permanently locks the token** (owner-initiated; a buggy UI loses the token). UIs MUST validate the recipient commitment before `release`. v1.x: consider an owner-cancel-pending path.
- **M3 — No contract-instance binding in commitments.** A `claim_commitment` is portable across deployments of this code. Fold an instance id into the hashed vector if multiple instances coexist.
- **C1 — Module `mint` is unauthenticated but is NOT a contract entrypoint** (the wrapper omits it from `export`; only `mintAdmin` is callable). Do not add `mint` to the wrapper export list.
- **L2 — No supply cap / tokenId-range enforcement.** `mintAdmin` accepts any `Uint<64>`. Enforce a cap if this backs a fixed collection (cf. umbrella rule: SEAL = 906).
