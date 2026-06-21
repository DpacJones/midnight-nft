# midnight-nft — Handoff / Status (2026-06-20)

A self-contained summary of what we built, what we proved, and what we learned. Code lives in a local git repo (`~/projects/midnight-nft`, not yet pushed to a remote — see "Getting the code").

## TL;DR

A **privacy-preserving NFT foundation on Midnight** — a shielded NFT (hidden owner) built on the official Midnight team's NFT contract, hardened and **proven end-to-end on a real local Midnight chain with real ZK proofs**. As of now it's a **privacy-complete v1** (37 tests passing): hidden ownership, private transfers, metadata, a real key-based admin — and we **empirically verified that user actions don't leak the caller on-chain**. Meant to be the shared "prove things privately" building block under NightSign / ZKCaptcha / the ZK-Browser Vault.

## What's built & proven

- **Contract** (`contracts/nft-zk`, Compact): shielded NFT with a **claim model** — ownership is a per-token hash commitment (`persistentHash(["nftzk:owner:v1", pubkey, local_secret, tokenId])`), not an address; transfers are two-step **`release` → `claim`** (zero-leakage: the sender releases to a recipient-generated `claim_commitment`, only the real recipient can claim); per-token **metadata URI**; **key-based admin** (`mintAdmin`/`rotateAdmin`, real tx-authenticated key).
- **Tests:** 37 in-process tests (multi-party: wrong-pubkey/wrong-salt claims rejected, non-owner release/burn rejected, unlinkability regression, admin rotation, metadata, etc.).
- **Real-chain demo** (`harness/midnight`): deploys to a local Midnight chain and runs **deploy → mint → claim → burn, each landing on-chain with real ZK proofs verified by the ledger.**

## Key things we figured out (worth sharing)

1. **Don't build the NFT from scratch — the Midnight team publishes one.** Base = `midnightntwrk/example-nft-contracts` (Apache-2.0, has a transparent `Nft` and a shielded `NftZk`). We vendored it and adapted: removed its shared-secret model, added per-token unlinkable commitments, the release/claim flow, metadata, and a real key-based admin.
2. **Privacy actually holds on-chain — verified, not assumed.** We queried the indexer against our own demo's transactions: the wallet's coin public key is **absent** from the raw `claim` and `burn` transactions, unshielded outputs are empty, the indexer schema has no submitter field, and fees are shielded (DUST). So **claim/transfer/burn are caller-unlinkable** — an observer sees *what token changed, not who did it*. The only op that reveals an identity is `mintAdmin` (it proves caller == the public admin key — reveals the *admin*, by design, not a user, and not the recipient).
3. **No relayer needed for user privacy.** Midnight's fee token (DUST) is shielded and supports native fee-delegation / sponsored transactions, but user privacy already holds without it. (Sponsored-tx is just a gas-UX option, e.g. a treasury funding users' fees.)
4. **Compact gotchas that cost us time** (so they don't cost you): pin `compactc` + `compact-runtime` + SDK *together* (version skew errors at proof time, e.g. compactc 0.31 ↔ runtime 0.16); `persistentHash` returns `Bytes<32>` while `transientHash` returns `Field`; no native strings (store URIs per-token); `from` is a reserved word (use `sender`); there is **no in-process verifier** — verifying a proof requires submitting to the ledger.

## How to run the demo

In `harness/midnight/README.md`, but the gist: build the contract (`yarn compact`), copy `contracts/managed/nft-zk` → `harness/midnight/contract/managed`, `npm install`, bring up a local Midnight chain (proof-server 8.0.3 / node 0.22.3 / indexer-standalone 4.0.0 on ports 6300/9944/8088), then `npm run demo`. Expected: `DEMO OK`.

## What's left (all non-blocking)

- **Private admin** (optional): `mintAdmin` reveals the admin by design; only needed if admin *anonymity* is ever required → Schnorr-in-circuit.
- Minor: supply cap, contract-instance binding in commitments, an owner-cancel-pending path, and a "use a fresh claim_salt per claim" rule for wallets.
- **Optional certainty:** the privacy result is verified on a local standalone chain; a few questions for the Midnight Foundation (in our notes) would confirm preprod/mainnet parity.
- Full honest list: `contracts/nft-zk/KNOWN_LIMITATIONS.md`.

## Getting the code

It's a local git repo (`~/projects/midnight-nft`, ~10 commits, clean history off the pristine vendored base). It is **not pushed to a remote yet** — to collaborate, push it to GitHub (private is fine). Key docs in-repo: `OVERVIEW.md` (what & why, plain language), `KNOWN_LIMITATIONS.md` (honest caveats), `harness/midnight/README.md` (run steps).
