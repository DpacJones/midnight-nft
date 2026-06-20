# CLAUDE.md — midnight-nft (Atlantis umbrella)

# 🌙 Midnight foundation
This is THE standalone Midnight NFT foundation project (shielded NFT base, vendored
from the official Apache-2.0 `example-nft-contracts`). Before Compact/ZK work, read the
umbrella foundation hub (the ⭐ START HERE block):
- Windows: `C:\Users\denni\Atlantis\References\Midnight\README.md`
- WSL: `/mnt/c/Users/denni/Atlantis/References/Midnight/README.md`

Load-bearing:
- Build target = `contracts/nft-zk` (shielded). `contracts/nft` is the transparent control.
- Toolchain: compactc **0.31.0** (↔ runtime 0.16; `compact update 0.31.0`), node 24.11.1, yarn via corepack. Build `yarn compact`, test `yarn test`.
- License: vendored base is **Apache-2.0** (permissive); our modifications stay Apache-2.0. See `NOTICE`.
- Adaptation roadmap is in `README.md`; #1 = harden the `shared_secret` model.
- Wallet = 1AM (1am.xyz). Pin compactc+runtime together (version drift is the #1 footgun).
