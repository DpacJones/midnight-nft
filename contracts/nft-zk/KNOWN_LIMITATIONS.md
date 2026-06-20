# NftZk (claim-model) — Known Limitations

Status: **v1 foundation — safe for local/testnet, NOT mainnet/value-bearing.** From an adversarial review 2026-06-20. The ownership/transfer state machine is sound (no duplication/loss, no stranger front-running, correct domain separation, claim auth anchored to the unforgeable `ownPublicKey()`). The items below are logged honestly per the Engine Honesty Posture — do **not** describe v1 privacy as stronger than stated here.

## Blockers before any value-bearing / mainnet use

- **H2/M2 — Ownership linkability (the headline).** Owner commitment = `persistentHash(["nftzk:owner:v1", pubkey, local_secret])` is deterministic. If a user reuses one `local_secret` across tokens, every one of their tokens maps to the **same on-chain `Bytes<32>`**, so an observer can link all co-owned tokens to each other; and the claim tx is itself pubkey-authenticated at the ledger layer, so the linkable commitment is written under an observable submitter. **v1 privacy guarantee is only "the raw pubkey is not stored on-chain" — NOT unlinkability across a user's tokens.** Fix (v1.1): per-token derived secret (e.g. fold `tokenId`/a PRF into the commitment), which also requires rethinking the count-based `balanceOf`. Also verify exactly what the Midnight submitter identity exposes publicly.
- **M1 — Admin is a shared-secret preimage, not a keypair.** `contractAdmin = persistentHash(admin_secret)`; auth = "prove knowledge of a preimage." It is effectively a shared password: leak = permanent, silent, unrevocable mint compromise. `rotateAdmin` to a no-known-preimage value bricks minting. Acceptable for a single-operator testnet; for custodial use, bind admin to a tx-authenticated `ownPublicKey()` / real signature, and make rotation two-step.

## Lower-severity / by-design

- **C2 — The claim salt is privacy, not theft protection.** Claim auth is anchored to the recipient's unforgeable pubkey; the salt only provides unlinkability. Do not present the salt to users as a password that protects the token. (A stranger cannot steal a pending claim even if they see the commitment — they'd need to *be* the recipient pubkey.)
- **H1 — Releasing to a malformed commitment permanently locks the token.** Owner-initiated only (self-grief), but a buggy off-chain UI handing a bad `claim_commitment` loses the token with no recovery (can't claim/release/burn a pending token). v1.1: consider an owner-cancel-pending path (carefully, to preserve zero-leakage). For now: UIs MUST validate the recipient commitment before `release`.
- **M3 — No contract-instance binding in commitments.** A `claim_commitment` is portable across deployments of this code. Minor for a single deployment; fold an instance id into the hashed vector if multiple instances coexist.
- **C1 — Module `mint` is unauthenticated but is NOT a contract entrypoint** (the wrapper deliberately omits it from `export`; only `mintAdmin` is callable). Landmine only if someone adds `mint` to the wrapper export list — do not.
- **L2 — No supply cap / tokenId-range enforcement.** `mintAdmin` accepts any `Uint<64>`. If this ever backs a fixed collection, enforce the cap (cf. umbrella rule: SEAL = 906).

## Addressed in v1

- **H3 — Counter underflow** guarded: `release`/`burn` assert `ownedTokensCount.lookup(meCommit) >= 1` before `decrement`.
