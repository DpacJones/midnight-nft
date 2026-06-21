# Midnight NFT Foundation — what we've built and where it's going

*A plain-language overview. For technical detail see `README.md`, `KNOWN_LIMITATIONS.md`, and the design docs in the Atlantis vault under `References/Midnight/`.*

## The one-sentence version

We're building a **private NFT** on the Midnight blockchain — a digital token whose *owner is hidden* — as a **shared foundation** that several projects (NightSign, ZKCaptcha, the ZK-Browser Vault) can build on instead of each reinventing it.

## Why this is worth doing

Most blockchains are fully public: anyone can look up who owns what. Midnight is built for **privacy**, using zero-knowledge proofs (a way to *prove something is true without revealing the underlying details*).

A normal NFT broadcasts "wallet 0xABC owns token #5" to the world. We want NFTs where you can **prove you own or are allowed something without revealing who you are.** That same building block — *prove a fact privately* — is what our other Midnight projects need too:
- **NightSign** proves a document was validly signed without exposing the signers.
- **ZKCaptcha** proves an address is on a private trust-list without exposing the list.
- **The ZK-Browser Vault** proves you're allowed to recover a key without exposing your identity.

So rather than each project solving "private ownership/membership" separately, we build it **once**, properly, here.

## What we've actually done

1. **Mapped the territory.** Researched the Midnight ecosystem — tools, official code, gotchas — and wrote it down.
2. **Got it running.** Stood up the Midnight toolchain and produced a **real zero-knowledge proof end-to-end** — the whole pipeline works here, not just in theory.
3. **Picked the right starting point.** Found the **official, openly-licensed (Apache-2.0)** privacy NFT published by the Midnight team, verified it builds and passes its tests, and made our own copy to build on.
4. **Fixed its biggest weakness.** The official version used a single shared secret that quietly broke privacy. We redesigned ownership and transfers to remove it. Transfers now work like a **secure drop-off and pick-up**: the sender "releases" a token to a private code the recipient generated, and only the real recipient can "claim" it — no one watching the chain can tell who received it.
5. **Had it attacked.** An independent security review tried to break it (steal tokens, forge claims, leak secrets). The core held up; the real limitations it found are documented honestly (see below).
6. **Hardened and added features.** Folded in the review's safe fixes, then added **metadata** so each token can carry a name/image (via a link) that follows the token through transfers.

Everything above is **real, tested code** (34 automated tests passing) with a clean git history.

## How it works, in plain terms

- Your **ownership isn't stored as your address** — it's a scrambled fingerprint only *you* can reproduce (from a secret only you hold). Outsiders see a meaningless code, not "you."
- **Transfers are two steps** ("release" then "claim") so the chain never records a direct "A sent to B" link.
- **Minting is controlled** by a treasury/admin role — but even the admin's identity isn't written to the chain.
- **Metadata (name, image) is public** on purpose — you want to *display* an NFT — and is kept separate from the private ownership.

## What's honest about it today

We're being upfront (it's a core principle):
- **This is a testnet-grade foundation, not money-ready yet.** Two things must be fixed before it holds real value:
  - **Privacy is partial.** Today, if you own several tokens, a careful observer could tell those tokens *belong to the same (unknown) person* — they can't name you, but they can group your holdings. The fix is designed and queued.
  - **Admin control is a shared password, not a proper key.** Fine for testing; needs upgrading before anyone custodial relies on it.
- See `KNOWN_LIMITATIONS.md` for the full list — so nobody mistakes the current state for "finished privacy."

## What we're building toward

- **Short term:** close the privacy gap above (a unique, unlinkable fingerprint per token), then smaller polish.
- **Medium term:** this becomes the **shared privacy engine** under NightSign, ZKCaptcha, X-Multi, and the Vault Guardian — one well-reviewed piece instead of four shaky ones.
- **The bigger picture:** private, identity-aware digital assets — NFTs and credentials you can *prove things about* without exposing yourself (a membership pass, an accreditation, a genuinely-private collectible) — eventually tied into Midnight's emerging digital-identity (DID) system.

The throughline: **prove what's true, reveal only what you must.** That's Midnight's whole promise, and this foundation is us learning to build on it for real.
