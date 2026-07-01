# NFT-ZK Contract Documentation

## Overview

The NFT-ZK (privacy-preserving non-fungible token) contract is a modular, privacy-focused NFT for the
Midnight blockchain with **hidden ownership** using zero-knowledge proofs. Ownership is a per-token hash
**commitment** rather than a public address, transfers are a two-step release/claim flow that records no
sender to recipient link, and each token carries a public metadata URI. This document covers the **core
module** that developers import and the **example contract** that adds a secret-derived admin.

## Modular pattern

- **Module** (`./modules/NftZk.compact`): the reusable privacy-preserving NFT functionality you import.
- **Example contract** (`nft-zk.compact`): shows how to wrap the module with a secret-derived admin.
- **Your implementation**: import the module and apply your own authorization pattern.

### The key distinction

The module exports its circuits with no authorization. The example contract chooses which to expose and
adds admin gating. Importantly, the module defines a raw `mint` circuit, but the example contract **does
not export it** (only the admin-gated `mintAdmin` is callable). Do not add `mint` to the wrapper export
list, since it is unauthenticated.

## Privacy model

### Per-token owner commitment

Ownership is stored as:

```
persistentHash(["nftzk:owner:v1", pubkey, local_secret, tokenId])
```

`tokenId` is folded in so that a holder's tokens each produce a **different** on-chain commitment, which
means an observer cannot group a person's holdings (unlinkability). The commitment can only be reproduced
by the holder, because it depends on `local_secret`, a witness that never leaves their device.

### Claim (in-transit) commitment

A token that is mid-transfer or freshly minted sits in a pending state under a claim commitment:

```
persistentHash(["nftzk:claim:v1", recipient_pubkey, claim_salt])
```

The recipient builds this off-chain from a fresh `claim_salt` and shares only the commitment.

### Design choices

- **No on-chain `balanceOf`.** A stable per-user count would itself be a linkability leak, so balance and
  enumeration are handled offline by the wallet (recompute owner commitments locally, compare to the
  indexer's public state).
- **Metadata is public.** Each token has a `tokenUri` (`Bytes<64>`), set at mint and carried through
  transfers, removed on burn. It is intentionally public, since you want to display an NFT.
- **Approvals are not included.** This variant has no `approve` / `transferFrom` / operator model. Access
  is proof of the owner or claim secret.

## Ledger state

| Field | Type | Meaning |
|---|---|---|
| `tokenOwner` | `Map<Uint<64>, Bytes<32>>` | tokenId to owner commitment |
| `pendingClaims` | `Map<Uint<64>, Bytes<32>>` | tokenId to claim commitment (in transit) |
| `tokenUri` | `Map<Uint<64>, Bytes<64>>` | tokenId to public metadata URI |
| `contractAdmin` | `AdminPublicKey` | derived admin public key (example contract) |

## Witnesses

Your TypeScript implementation provides:

```compact
// module (NftZk.compact)
witness getLocalSecret(): Bytes<32>    // the owner's self secret (self-custody)
witness getClaimSalt(): Bytes<32>      // the recipient's fresh per-claim salt

// example contract (nft-zk.compact)
witness localSecretKey(): AdminSecretKey  // the admin secret; derives contractAdmin
```

## Circuit reference

### Module circuits

- `commitOwner(pk: Bytes<32>, secret: Bytes<32>, tokenId: Uint<64>): Bytes<32>` — pure. Build a per-token
  owner commitment.
- `commitClaim(pk: Bytes<32>, salt: Bytes<32>): Bytes<32>` — pure. Build a claim commitment.
- `tokenExists(tokenId: Uint<64>): Boolean` — whether a token is owned or pending.
- `ownerOf(tokenId: Uint<64>): Bytes<32>` — the owner commitment of an owned token (a hash, reveals no
  identity and links no tokens).
- `pendingOf(tokenId: Uint<64>): Bytes<32>` — the claim commitment of a pending token.
- `uriOf(tokenId: Uint<64>): Bytes<64>` — the token's metadata URI.
- `release(tokenId: Uint<64>, claim_commitment: Bytes<32>): []` — the owner proves ownership (re-derives
  their commitment and checks it matches the stored one) and moves the token into a pending claim.
- `claim(tokenId: Uint<64>): []` — the recipient proves they are the party behind the claim commitment and
  takes ownership under their own owner commitment.
- `burn(tokenId: Uint<64>): []` — the owner burns their own token and its metadata.
- `mint(claim_commitment: Bytes<32>, tokenId: Uint<64>, uri: Bytes<64>): []` — create a new token into a
  pending claim, with metadata. **Module only, unauthenticated. Wrap with your own authorization.**

### Example contract circuits (`nft-zk.compact`)

- `mintAdmin(claim_commitment: Bytes<32>, tokenId: Uint<64>, uri: Bytes<64>): []` — **[admin only]** mint
  into a recipient's claim commitment. Asserts `contractAdmin == deriveAdminPublicKey(localSecretKey())`.
- `rotateAdmin(newAdmin: AdminPublicKey): []` — **[admin only]** hand issuance authority to a new admin
  public key (the new admin generates their secret locally and shares only the derived public key).
- `deriveAdminPublicKey(sk: AdminSecretKey): AdminPublicKey` — pure. Derive the admin public key from the
  admin secret, domain-separated to this contract (`nftzk:admin:pk:v1`).

## Transfer flow

```
recipient: build claim_commitment = commitClaim(recipient_pubkey, fresh claim_salt)  (off-chain)
owner:     release(tokenId, claim_commitment)   -> token moves to pendingClaims
recipient: claim(tokenId)                        -> token moves to tokenOwner under recipient's commitment
```

The chain records only that a token changed state, never who released or claimed it.

## Admin model

The deployer becomes the initial admin. The deployer's DApp generates an admin private key, keeps it in
private state, and the contract stores **only** the derived public key on the ledger. Admin authorization
is proof of knowledge of the admin secret: each admin circuit re-derives the public key from the
prover-held secret and checks it equals `contractAdmin`. An attacker who reads `contractAdmin` off the
ledger cannot reverse the hash to recover the secret, so they cannot satisfy the gate.

Authorization does **not** use `ownPublicKey()`. `ownPublicKey()` is a prover-supplied witness, not the
transaction signer, so it is not a trustworthy caller identity and must not be used for authorization on
its own. This is the single most important Compact authorization trap.

## Security considerations

1. **`ownPublicKey()` is a witness, not `msg.sender`.** Never authorize with it alone. Use secret-derived
   keys and commitment checks.
2. **Witnesses are untrusted input.** Constrain every witness value against on-chain state before trusting
   it.
3. **Domain separation.** All commitments are domain-separated (`nftzk:owner:v1`, `nftzk:claim:v1`,
   `nftzk:admin:pk:v1`) so values are not interchangeable across purposes or sibling contracts.
4. **Fresh claim salt per transfer.** Reusing a salt links two pending claims to the same recipient during
   the pending window. Wallets must generate a fresh salt per incoming transfer.
5. **No on-chain balance.** Enumeration is offline by design, avoiding a linkability leak.
6. **Releasing to a malformed commitment can lock a token.** UIs must validate the recipient commitment
   before `release`.

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for the full honest caveat list.

## License

Apache-2.0. See the license headers in the source files and the repository [LICENSE](../../LICENSE).
