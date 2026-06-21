# NftZk (claim-model) — Known Limitations

Status: **v1.1 foundation — safe for local/testnet, NOT yet mainnet/value-bearing.** The ownership/transfer state machine is sound (no duplication/loss, no stranger front-running, correct domain separation, claim auth anchored to the unforgeable `ownPublicKey()`), and ownership is now **unlinkable across a user's tokens** (per-token commitments). Remaining items below are logged honestly per the Engine Honesty Posture — do not describe v1 privacy as stronger than stated.

## Addressed in v1.1

- **H2 — Ownership linkability — FIXED.** Owner commitment now folds `tokenId` in: `persistentHash(["nftzk:owner:v1", pubkey, local_secret, tokenId])`. Each of a user's tokens gets a **different** on-chain commitment, so an observer can no longer group a user's holdings by their stored owner value. (Regression test: same owner's two tokens have distinct `ownerOf` values.)
- **On-chain `balanceOf` removed** (Architect ruling). A stable per-user count key was itself a linkability leak. Balance/enumeration is an **offline/wallet concern**: recompute per-token owner commitments locally and check them against the indexer's public state. Off-chain token-gating = a ZK proof or signed challenge done off-chain; no dedicated on-chain `isOwner` circuit (it would add cost + leak execution metadata).
- **H3 — Counter underflow** — moot (the counter is gone).

## Blockers before any value-bearing / mainnet use

- **M2 — Claim-tx submitter visibility (INFRASTRUCTURE, not contract).** Per-token commitments stop linking tokens *to each other*, but a **direct, un-relayed `claim` (or `release`/`burn`) transaction is authenticated by the caller's public key at the ledger/fee layer.** An observer of raw ledger txs can therefore link that single token to the caller's ledger identity at the moment they act. The contract cannot hide network-level submitter/fee-payer metadata. **Full end-to-end anonymity requires a relayer system or ledger-level fee shielding** — out of scope for the contract; planned as infra. Until then, treat on-chain actions as identity-revealing at the tx layer.
- **M1 — Admin is a shared-secret preimage, not a keypair.** `contractAdmin = persistentHash(admin_secret)`; auth = prove knowledge of a preimage. Effectively a shared password: leak = permanent, silent, unrevocable mint compromise; `rotateAdmin` to a no-known-preimage value bricks minting. Fine for single-operator testnet; for custodial use, bind admin to a tx-authenticated `ownPublicKey()` / real signature with two-step rotation.

## Usage requirements / lower-severity

- **Use a fresh `claim_salt` per claim.** The claim commitment is `persistentHash(["nftzk:claim:v1", recipient_pubkey, claim_salt])`. If a recipient reuses one salt, two pending claims to them share the same on-chain commitment → linkable *during the pending window*. Wallets must generate a fresh salt per incoming transfer. (Post-claim ownership is already unlinkable via H2.)
- **C2 — The claim salt is privacy, not theft protection.** Claim auth is anchored to the recipient's unforgeable pubkey; the salt only provides unlinkability. Do not present it to users as a token-protecting password.
- **H1 — Releasing to a malformed commitment permanently locks the token.** Owner-initiated only (self-grief), but a buggy off-chain UI handing a bad `claim_commitment` loses the token (a pending token can't be claimed/released/burned). UIs MUST validate the recipient commitment before `release`. v1.x: consider an owner-cancel-pending path (preserving zero-leakage).
- **M3 — No contract-instance binding in commitments.** A `claim_commitment` is portable across deployments of this code. Fold an instance id into the hashed vector if multiple instances coexist.
- **C1 — Module `mint` is unauthenticated but is NOT a contract entrypoint** (the wrapper omits it from `export`; only `mintAdmin` is callable). Do not add `mint` to the wrapper export list.
- **L2 — No supply cap / tokenId-range enforcement.** `mintAdmin` accepts any `Uint<64>`. Enforce a cap if this backs a fixed collection (cf. umbrella rule: SEAL = 906).
