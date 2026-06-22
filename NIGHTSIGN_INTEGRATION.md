# Why midnight-nft matters for NightSign

*Teammate-facing bridge doc. Read `HANDOFF.md` and `OVERVIEW.md` first for what midnight-nft is;
this explains how it plugs into our main NightSign product. Plain-ish language, with the actual
mechanism since this is foundational shared work.*

## The one-liner

midnight-nft isn't a side project — it's the **hardened identity/authorization primitive** that
NightSign's signing flow needs. NightSign already does multi-party signing; what it *can't* do yet
is prove that **specific authorized parties** signed. midnight-nft's reviewed `ownPublicKey()`-anchored
credential mechanism is exactly the missing piece.

## NightSign today, and the gap

NightSign already supports **M-of-N multi-signature** — threshold, signature count, an execution
latch, and a nullifier set so no key signs twice. For a 3- or 4-party legal document, that part is
done.

The gap is **who is allowed to sign**. NightSign's circuit authenticates a signer purely from a
private witness secret:

```compact
// NightSign sign_document() today (simplified):
const secret = signer_secret();                 // just bytes the prover supplies
const pk = persistentHash(["ns:pk:v1", secret]); // identity = "whoever knows the bytes"
assert(!signers_set.member(pk));                 // not already used
// ...count++, latch is_executed at threshold
```

There is **no allowlist**. Anyone who receives the document file + blinding salt and generates any
keypair is a valid signer. The "secret" isn't bound to a named party or a real wallet. For anonymous
attestation that's fine; **for a legal contract it's a hole** — you need "Alice, Bob, and Carol
specifically signed," not "three anonymous people who had the PDF."

## What midnight-nft already solved

The `NftZk` contract authenticates against **`ownPublicKey()`** — the real, transaction-authenticated
wallet key (unforgeable; you must *be* the key, not just know some bytes). Issuance is gated by a
real, rotatable **admin key** (`mintAdmin` asserts `ownPublicKey().bytes == contractAdmin`). Ownership
is a hiding, per-token commitment. This is built, **security-reviewed, 37 tests, and proven on a real
local Midnight chain** — far past NightSign's 6-test prototype circuit.

So the convergence thesis pays off literally: instead of NightSign re-deriving a weaker auth layer, it
**inherits this reviewed one**.

## The integration: a hybrid, soulbound credential

Keep NightSign's mechanism, swap *only* the identity layer:

| Layer | Source | Status |
|---|---|---|
| Document stays private (commitment + possession proof) | NightSign | keep |
| Threshold / count / execution latch | NightSign | keep |
| No double-sign (nullifier) | NightSign | keep, now bound to the real key |
| **Who may sign** | **midnight-nft** | **admin-issued, `ownPublicKey()`-anchored credential** |

Critically the signer credential is **soulbound** — we take NftZk's *commitment + `ownPublicKey` auth +
admin issuance* and **drop `release`/`claim`**. A transferable "right to sign" would be a legal bug.

The revised `sign_document` proves, in zero knowledge: (1) you possess the document, (2) you control an
admin-issued credential anchored to your real key, (3) your nullifier is unused, then (4) bumps the
counter / latches execution. Result: **private document + private signer identities + provably
authorized named parties + threshold + no double-sign.**

A concrete (not-yet-compiled) circuit sketch lives in our planning notes
(`nightsign_hybrid_sign_document_DRAFT.md`) — happy to paste it into this repo if the team wants to
review the Compact directly.

## The main open call (your input wanted)

**How should the signer allowlist be stored?**

- **Private roster (recommended):** store hiding commitments `persistentHash(["ns:cred:v1", pk, salt])`.
  Use **admin-side issuance** — the party shows the admin their pubkey off-chain (normal "this wallet
  is Alice's" check), the admin computes + inserts the commitment, and keeps the authoritative
  pk→party record off-chain (where legal audit trails already live). A signatory can later **open**
  their commitment (reveal `pk, salt`) to prove publicly they signed. Private-by-default,
  provable-on-demand. Matches how a firm actually holds signatory records.
- **Public roster:** store raw authorized pubkeys; sign by `ownPublicKey().bytes == rosterEntry`.
  Simpler, but publishes *who is allowed to sign* to every chain observer. Only preferable if a use
  case legally requires a **world-readable signatory register**.

Recommendation: private roster as the foundation; public only when a specific requirement demands it.

## What we'd love the team to do with the repo

1. **Read the auth core:** `contracts/nft-zk/src/modules/NftZk.compact` (commitment + `ownPublicKey`
   pattern) and `nft-zk.compact` (admin issuance). That's the exact primitive NightSign would adopt.
2. **Sanity-check the privacy claims:** `contracts/nft-zk/KNOWN_LIMITATIONS.md` is our honest list —
   poke at it. The empirical "caller is unlinkable on-chain" result especially deserves a second set
   of eyes.
3. **React to the integration shape above** — particularly the private-vs-public roster call and the
   soulbound decision.
4. **Run it** if you want proof of life: `harness/midnight/README.md` → `npm run demo` → `DEMO OK`
   (deploy → mint → claim → burn, real ZK proofs on a local chain).

## Honest caveats (so nobody over-reads it)

- This proves "holder of an issued credential," **not** legal identity. Binding to a legally
  recognized identity is later DID/Verifiable-Credential work, gated on Midnames/Identus being
  builder-ready.
- The on-chain privacy result is verified on a **local** standalone chain; preprod/mainnet should
  match (same tx format) but a couple of Midnight Foundation questions would make it airtight.
- The hybrid `sign_document` is a **design sketch**, not yet compiled or reviewed. It's a
  money/security-path circuit — it gets an adversarial review before it goes anywhere near production.
