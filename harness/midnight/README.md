# midnight-nft harness

Integration harness that deploys the `nft-zk` contract to a **local Midnight chain** and runs the full **mint → claim → burn** lifecycle with **real ZK proofs verified on-chain**. This is the end-to-end "consumer" proof for the foundation (the contract's own logic is also covered by the in-process test suite under `contracts/nft-zk/src/test`).

## Run

1. Build the contract, then copy its compiled output in (gitignored, regenerable). From the repo root after `yarn compact`:
   ```
   rm -rf harness/midnight/contract/managed
   cp -r contracts/managed/nft-zk harness/midnight/contract/managed
   ```
2. `cd harness/midnight && npm install`
3. Bring up a local Midnight chain — proof-server `:6300`, node `:9944`, indexer `:8088` (pinned set: proof-server 8.0.3, node 0.22.3, indexer-standalone 4.0.0). Any standard local Midnight `docker-compose` with those fixed ports works.
4. `npm run demo`

Expected output ends with `DEMO OK` — deploy + `mintAdmin` + `claim` + `burn`, each **landing on-chain** (the ledger only accepts a transaction whose ZK proof verifies, so a landed tx *is* proof of real-ZK-on-chain).

## Notes

- A **single wallet** plays admin + recipient. Multi-party authorization (wrong-pubkey/wrong-salt claims rejected, non-admin mint rejected, etc.) is covered by the in-process test suite, which can simulate distinct callers.
- Gitignored (regenerable / runtime): `contract/managed/`, `node_modules/`, `midnight-level-db/`.
- The off-chain `claim_commitment` is computed from the wallet's coin public key (what `ownPublicKey()` resolves to in-circuit) + the recipient's `claim_salt` — see `src/demo.ts`.
