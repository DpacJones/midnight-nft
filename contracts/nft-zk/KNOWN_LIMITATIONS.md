# NftZk (claim-model) — Known Limitations

Status: **v1.1 foundation. Both contract-level mainnet blockers fixed, and user-operation privacy is now empirically verified.** The ownership/transfer state machine is sound (no duplication/loss, no stranger front-running, correct domain separation, claim auth anchored to the unforgeable `ownPublicKey()`); ownership is unlinkable across a user's tokens; the admin is a real key. Items below are logged honestly per the Engine Honesty Posture.

## Verified working / addressed in v1.1

- **H2 — Ownership linkability — FIXED.** Owner commitment folds `tokenId` in: `persistentHash(["nftzk:owner:v1", pubkey, local_secret, tokenId])` → each token gets a distinct on-chain commitment; holdings can't be grouped by stored owner value.
- **M1 — Admin is a real, tx-authenticated key — FIXED.** `contractAdmin = ownPublicKey().bytes`; `mintAdmin`/`rotateAdmin` assert `ownPublicKey().bytes == contractAdmin`. Tradeoff (accepted): admin pubkey is on-chain (operational role).
- **M2 — Caller/submitter visibility — EMPIRICALLY RESOLVED for user operations (2026-06-20).** On the local standalone chain + indexer, the wallet's coin public key does **NOT** appear in the raw `claim` or `burn` transactions; `unshieldedCreatedOutputs`/`unshieldedSpentOutputs` are empty; the indexer schema has **no** submitter/sender field; fees are shielded DUST. So an observer sees *that token X changed*, not *who did it* — and `release`→`claim` transfers inherit this. **`mintAdmin` is the one op whose raw tx contains a pubkey — the admin's — by design (it proves caller == the public `contractAdmin`); it reveals the admin (a known role, public anyway), NOT a user, and NOT the recipient (mint targets a claim commitment).** Net: **a relayer is NOT required for user privacy**; sponsored-tx / DUST-delegation is now only a gas-UX option (treasury funds fees).
  - *Confidence/caveats:* verified on the **local standalone** chain; preprod/mainnet use the same tx/ledger format so it should hold, but the drafted Foundation questions (network-level fee-payer + preprod parity) would make it airtight. The raw-tx check was a hex substring search (no full decode) — strong evidence, not a formal proof.
- **On-chain `balanceOf` removed** (anti-privacy); balance is offline/wallet enumeration. **H3 counter underflow** — moot (counter removed).

## Remaining real items (none are user-privacy blockers)

- **Private admin (optional).** `mintAdmin` reveals the admin by design. Only needed if admin *anonymity* ever becomes a requirement → would need Schnorr-in-circuit (proving knowledge of a key behind a committed admin pubkey). Deferred.
- **Use a fresh `claim_salt` per claim.** Reusing one salt makes two pending claims to the same recipient share an on-chain commitment → linkable *during the pending window*. Wallets must generate a fresh salt per incoming transfer. (Post-claim ownership is unlinkable via H2.)
- **C2 — The claim salt is privacy, not theft protection.** Claim auth is anchored to the recipient's unforgeable pubkey; the salt only provides unlinkability.
- **H1 — Releasing to a malformed commitment permanently locks the token** (owner-initiated; a buggy UI loses it). UIs MUST validate the recipient commitment before `release`. v1.x: consider an owner-cancel-pending path.
- **M3 — No contract-instance binding in commitments.** A `claim_commitment` is portable across deployments. Fold an instance id into the hashed vector if multiple instances coexist.
- **C1 — Module `mint` is unauthenticated but is NOT a contract entrypoint** (wrapper omits it from `export`; only `mintAdmin` is callable). Do not add `mint` to the wrapper export list.
- **L2 — No supply cap / tokenId-range enforcement.** Enforce a cap if this backs a fixed collection (cf. umbrella rule: SEAL = 906).
