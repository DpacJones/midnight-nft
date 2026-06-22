# NightSign hybrid `sign_document` — DRAFT circuit sketch

> **⚠️ NOT COMPILED. Design sketch for team review (Builder/Claude, 2026-06-22).**
> Companion to `nightsign_multisig-identity-layer.md`. Grounded in the live circuits:
> NightSign `night_sign.compact` (possession + threshold + nullifier) and midnight-nft
> `NftZk.compact` (`ownPublicKey()` auth + admin issuance). Targets compactc 0.31.0 /
> language ≥ 0.22. Treat every line as a discussion prompt, not final code.

## What changed vs today's NightSign

| Layer | NightSign today | This draft |
|---|---|---|
| Document privacy | sealed `document_commitment` + possession proof | **unchanged** |
| Threshold / count | `required_signers`, `signature_count`, `is_executed` | **unchanged** |
| No double-sign | `signers_set` nullifier | **unchanged** (nullifier now bound to the real key) |
| **Who may sign** | anyone with a witness secret (no allowlist) | **admin-issued, `ownPublicKey()`-anchored, soulbound credential** |
| Issuer | — | real, rotatable admin key (NftZk M1 pattern) |

## The sketch

```compact
pragma language_version >= 0.22.0;

import CompactStandardLibrary;

// ---- Ledger state ---------------------------------------------------

// (NightSign — unchanged) hiding commitment to the document fingerprint.
export ledger document_commitment: Bytes<32>;

// (NightSign — unchanged) threshold + progress + execution latch.
export ledger required_signers: Uint<64>;
export ledger signature_count: Counter;
export ledger is_executed: Boolean;

// (NightSign — unchanged) nullifier set: each authorized party signs at most once.
export ledger signers_set: Set<Bytes<32>>;

// NEW (allowlist) — the roster of authorized signer CREDENTIALS. Each entry is a
// hiding commitment to an authorized party's pubkey; admin-issued. Storing a
// commitment (not the raw pubkey) keeps the roster from being a public list of
// who's allowed to sign.
export ledger signerRoster: Set<Bytes<32>>;

// NEW (NftZk M1 pattern) — issuer is a real, tx-authenticated, rotatable key.
export ledger contractAdmin: Bytes<32>;

// ---- Constructor ----------------------------------------------------

// Seals the document commitment + threshold (NightSign) and records the deployer
// as the initial issuing admin (NftZk M1). The roster is filled post-deploy via
// issueSigner, so parties can be added before signing opens.
constructor(commitment: Bytes<32>, signers: Uint<64>) {
  document_commitment = disclose(commitment);
  required_signers    = disclose(signers);
  contractAdmin       = disclose(ownPublicKey().bytes);
}

// ---- Witnesses (private) -------------------------------------------

witness doc_hash(): Bytes<32>;          // local SHA-256 of the document (NightSign)
witness doc_salt(): Bytes<32>;          // blinding salt distributed with the document
witness signer_cred_salt(): Bytes<32>;  // the per-party salt the admin issued to THIS signer

// ---- Pure helpers ---------------------------------------------------

// (NightSign — unchanged) must match the off-chain commitment sealed at deploy.
circuit compute_commitment(dh: Bytes<32>, salt: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "ns:doc:v1"), dh, salt]);
}

// NEW — signer credential = hiding commitment over (real pubkey, issuance salt).
// Privacy via the salt (so the roster isn't a guessable hash of a known pubkey);
// authorization comes from ownPublicKey() == pk at sign time, not from the salt.
circuit commit_credential(pk: Bytes<32>, cred_salt: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<3, Bytes<32>>>([pad(32, "ns:cred:v1"), pk, cred_salt]);
}

// NEW — nullifier bound to the REAL key (not a portable secret), so a given
// authorized party can sign exactly once and can't forge another's nullifier.
circuit compute_nullifier(pk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "ns:nul:v1"), pk]);
}

// ---- Issuance (admin only; mirrors NftZk mintAdmin) ----------------

// The party computes cred = commit_credential(theirPubkey, cred_salt) OFF-CHAIN
// (keeping cred_salt private) and hands the admin the commitment out-of-band; the
// admin inserts it. Admin never learns the salt; the roster reveals no identities.
export circuit issueSigner(cred_commitment: Bytes<32>): [] {
  assert(ownPublicKey().bytes == contractAdmin, "NightSign: not authorized to issue");
  signerRoster.insert(disclose(cred_commitment));
}

export circuit rotateAdmin(newAdmin: Bytes<32>): [] {
  assert(ownPublicKey().bytes == contractAdmin, "NightSign: not authorized to rotate");
  contractAdmin = disclose(newAdmin);
}

// ---- Main circuit ---------------------------------------------------

// SOULBOUND by construction: there is no release/claim/transfer of a credential.
export circuit sign_document(): [] {
  assert(!is_executed, "NightSign: document already executed");

  // 1. Possession of the document (NightSign) — keeps the doc private, binds to THIS doc.
  const dh = doc_hash();
  const salt = doc_salt();
  assert(compute_commitment(dh, salt) == document_commitment,
    "NightSign: document does not match the sealed commitment");

  // 2. Authorization (NftZk) — caller is an admin-issued, allowlisted party,
  //    anchored to the unforgeable transaction key.
  const me = ownPublicKey();
  const cred = commit_credential(me.bytes, signer_cred_salt());
  assert(signerRoster.member(disclose(cred)),
    "NightSign: not an authorized signer");

  // 3. Uniqueness (NightSign) — nullifier is bound to the real key.
  const nul = compute_nullifier(me.bytes);
  assert(!signers_set.member(disclose(nul)),
    "NightSign: this party has already signed");

  // 4. State update (NightSign).
  signers_set.insert(disclose(nul));
  signature_count.increment(1);
  if (signature_count >= required_signers) {
    is_executed = true;
  }
}
```

## Open design forks for the team to react to

1. **Private roster vs public-pubkey roster.** Above keeps the roster as commitments
   (private) but relies on an out-of-band trust step at issuance: the admin trusts that
   the commitment a party hands over really binds that party's pubkey. The alternative —
   store raw authorized pubkeys and check `ownPublicKey().bytes == rosterEntry` — is
   simpler and removes the trust step, but publishes *who is allowed to sign*. Legal use
   may actually *want* that (a visible, auditable signatory list); privacy use does not.

   **→ Builder recommendation (2026-06-22): private roster (Option P), with two refinements.**
   - **Admin-side issuance** removes the trust step: the party reveals their *pubkey* to
     the admin off-chain (the firm's normal "this wallet is Alice's" identity check), and
     the **admin** computes + inserts `persistentHash(["ns:cred:v1", pk, salt])`. The
     privacy boundary is third-party chain observers, not the admin (who is the trusted
     issuer anyway). This yields an off-chain authoritative pk→party record at the firm —
     where legal audit trails already live. *(Circuit `issueSigner` is unchanged — it still
     takes only the commitment so no pubkey lands on-chain; the improvement is procedural.)*
   - **Selective disclosure** is the bridge: a signatory opens their commitment by revealing
     `(pk, salt)` to prove publicly they signed (court/counterparty). Private-by-default,
     provable-on-demand.

   **Why P over V here:** matches real legal practice (signatories known to parties + firm,
   not the world); low marginal risk (P is the *same* mechanism as midnight-nft NftZk —
   already built + 37-test-reviewed); sound (signing needs unforgeable `ownPublicKey()==pk`
   AND roster membership AND unused nullifier — learning the salt doesn't let you sign).

   **Honest caveat (where V wins):** P is NOT a strict superset of V. V lets *anyone* read
   the full signatory list unilaterally; P reproduces that only if *every* party discloses.
   If a use case requires a **publicly verifiable register of signatories** (a recorded,
   world-open instrument), V is required — switch then. That's the exception, not the
   law-firm default.

   **Pragmatic gate:** a throwaway wedge-validation demo MAY start with V (faster: no salt,
   admin inserts pubkeys, signer proves membership) **only if** the `commit_credential`
   helper stays in the code so upgrading to P is a derivation change, not a rewrite.
2. **Instance binding (NftZk M3).** Fold the contract address / `document_commitment`
   into `commit_credential` and `compute_nullifier` so a credential issued for *this*
   contract can't be replayed against another deployment.
3. **Fresh salt discipline (NftZk C2).** One `cred_salt` per party per contract; reuse
   re-introduces linkability across documents.
4. **Issuer identity.** Who holds `contractAdmin` — the matter's coordinating lawyer, the
   platform, a multisig? Trust/governance question, not crypto.
5. **N-of-N vs M-of-N.** `required_signers == roster size` gives "all named parties must
   sign"; a smaller threshold gives "any M of N." Both already work.
6. **Last mile (unchanged caveat).** This proves "issued-credential holder," not legal
   identity — that's the gated Phase-3 DID/VC work.

## Verification story (for a court / counterparty later)

On-chain, after execution: which document (verifiable if you hold doc+salt), the
signature count, the execution flag, and the set of signer nullifiers — each provably
corresponding to an *issued* credential, without revealing who, unless a party elects
selective disclosure.
