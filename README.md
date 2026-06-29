# midnight-nft

Privacy-preserving (shielded) **NFT and credential primitives for Midnight**, written in [Compact](https://docs.midnight.network/). Two of the three contracts contain original contract logic built well beyond any example: a **zero-leakage shielded NFT** and a **soulbound credential primitive** that has been submitted as a Midnight Improvement Proposal.

| | |
|---|---|
| **Toolchain** | compactc `0.31.0`, compact-runtime `0.16`, ledger `v8`, midnight-js `4.0.4`, Node `24.11.1`, yarn |
| **Build** | `yarn install && yarn compact` (compiles 25 circuits across 3 contracts) |
| **Test** | `yarn test` — **65 tests, all passing** (in-process vitest, no Docker) |

## What's original here

This is **not** a renamed template. The repo vendors the Apache-2.0 `midnightntwrk/example-nft-contracts` as a starting point (attributed in `NOTICE`), then adds substantial original contract logic on top:

### `contracts/credential-zk` — Soulbound Credential Primitive (new, original)

A non-transferable shielded credential contract, written from scratch. It is the reference implementation for **MIP-A**, submitted to `midnightntwrk/midnight-improvement-proposals` as **PR #214** (co-authored). Full spec lives at `contracts/credential-zk/MIP-A-soulbound-credential-primitive.md`.

- **Commitment-bound holder** — no plaintext owner field on-chain; the holder builds a hiding commitment off-chain.
- **Secret-derived issuer authority** — store `H([tag, sk])` and prove knowledge of `sk` per call, instead of the forgeable `ownPublicKey()` auth pattern.
- **Private non-revocation** via an **Indexed Merkle Tree** — prove a credential is *not revoked* without revealing the handle or which gap it occupies.
- **Non-revealing membership** via a **HistoricMerkleTree** — prove a credential *is issued* against any historic root, so in-flight proofs survive later issuance.
- **One `provePresentation(verifierChallenge)` circuit** binds membership + non-revocation + holder-key-control over a single opening, returning a **challenge-bound nullifier** for replay protection.
- **Per-deployment namespace** via a `deploymentSalt` constructor param (`kernel.self()` is unavailable in-constructor on Midnight).
- **28 tests**; cleared an internal adversarial security review and an external audit pass.

### `contracts/nft-zk` — zero-leakage shielded NFT (substantially reworked)

The vendored example shipped a single global `shared_secret` for transfers, which anyone holding it can de-anonymise. That was removed and replaced with original logic:

- **Ownership is a per-token commitment** `persistentHash(["nftzk:owner:v1", pubKey, local_secret, tokenId])`. Your public key never lands on-chain, and folding in `tokenId` makes your holdings unlinkable across tokens.
- **Transfers are a zero-leakage release → claim.** The sender releases to an off-chain `claim_commitment`; the recipient claims by proving `persistentHash(["nftzk:claim:v1", ownPublicKey(), salt]) == it`. No recipient named on-chain, no wallet-scanning, no stranger front-run.
- **Secret-derived admin key** (replaced a forgeable `ownPublicKey()` check).
- **On-chain per-token metadata** (`tokenUri`), set at mint and preserved across transfer.
- **16 tests**, plus a runnable real-chain demo in `harness/midnight` (deploy → mint → claim → burn, each landing on-chain with real ZK proofs).

### `contracts/nft` — transparent ERC-721-style reference

The transparent control contract from the base, kept for comparison, with admin auth hardened to the same secret-derived pattern. **21 tests**.

## Layout

```
contracts/<name>/src/*.compact        the contracts
contracts/<name>/src/test/*.test.ts   simulator tests
contracts/managed/<name>/             compiled output (circuits, keys, zkir)
harness/midnight/                     runnable demo: deploy nft-zk to a local chain, mint/claim/burn with real proofs
```

## Quick start

```bash
# compactc 0.31.0 on PATH (compact update 0.31.0), Node 24.11.1
yarn install
yarn compact        # compile all three contracts
yarn test           # 65 tests
```

## Attribution

Starting point: `midnightntwrk/example-nft-contracts` @ `f386411` (Apache-2.0). See `NOTICE`. All modifications remain Apache-2.0.
