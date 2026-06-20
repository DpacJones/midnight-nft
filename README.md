# midnight-nft

Standalone **Midnight NFT foundation** for the Atlantis umbrella — a shielded
(privacy-preserving) NFT base meant to be consumed by NightSign, ZKCaptcha,
X-Multi, and the ZK-Browser Vault Guardian. Code in WSL `~/projects/`; knowledge
in the Atlantis vault `References/Midnight/`.

## What this is

Vendored from the official, Apache-2.0 `midnightntwrk/example-nft-contracts`
(commit `f386411`). See `NOTICE` for attribution. Two contracts:

- `contracts/nft`    — transparent ERC-721-style (control / reference)
- `contracts/nft-zk` — **shielded**: ownership stored as `hash(pubkey, secret)`, pubkey never on-chain. **Our build target.**

## Toolchain (verified building 2026-06-20)

- compactc **0.31.0** (pairs with `compact-runtime` 0.16) — `compact update 0.31.0`
- node 24.11.1 (nvm), yarn via corepack
- Build: `yarn install && yarn compact` · Test: `yarn test` (43 tests pass, in-process vitest, no Docker)

## Adaptation roadmap (our work ON TOP of the vendored base)

1. **Shared-secret / key-exchange scheme** — the example uses a single global `shared_secret` (de-anonymisable by anyone holding it). Design a real per-recipient scheme. **[#1 priority]**
2. **Metadata** — neither module ships `tokenURI`; add NMKR-style on-chain metadata + IPFS/Arweave URIs.
3. **Admin** — replace the single-admin keypair with our treasury/multisig model (keep the privacy-preserving derived-pubkey pattern).
4. **tokenId scheme** — currently `Uint<64>`.

The shared reusable primitive (hash-commitment of identity) is intended to back
the membership/attestation flows in the sibling projects too.

Caveats + deep read: vault `References/Midnight/NftZk read-through — how the official shielded NFT works.md`.
