// End-to-end demo: deploy nft-zk to the local Midnight chain and run the full lifecycle
// with REAL ZK proofs and on-chain verification. One wallet plays admin + recipient
// (multi-party authorization is covered by the in-process test suite). Each callTx that
// lands proves its ZK proof verified on-chain (the ledger only accepts verified proofs).
//
// Requires the local chain:  docker compose -f tooling/midnight/docker-compose.yml up -d
// Run: npm run demo
import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { GENESIS_MINT_WALLET_SEED, standaloneConfig } from "./config.js";
import { buildWallet, ensureDust } from "./wallet.js";
import { configureProviders } from "./providers.js";
import { ledgerOf, pureCircuits } from "./contract.js";
import { deployNftZk } from "./app.js";

setNetworkId("undeployed");

const b32 = (s: string): Uint8Array => {
  const e = new TextEncoder().encode(s);
  const o = new Uint8Array(32);
  o.set(e.slice(0, 32));
  return o;
};
const b64 = (s: string): Uint8Array => {
  const e = new TextEncoder().encode(s);
  const o = new Uint8Array(64);
  o.set(e.slice(0, 64));
  return o;
};
const hx = (b: Uint8Array): string =>
  Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");

const TOKEN = 1n;
const URI = b64("ipfs://QmMidnightNftDemo");

const main = async () => {
  const ctx = await buildWallet(standaloneConfig, GENESIS_MINT_WALLET_SEED);
  await ensureDust(ctx.wallet, ctx.unshieldedKeystore);
  const providers = await configureProviders(ctx, standaloneConfig);
  console.log("wallet + providers ready");

  // This wallet's off-chain secrets (acts as admin AND recipient for the demo).
  const privateState = {
    local_secret: b32("demo:local-secret"),
    claim_salt: b32("demo:claim-salt"),
  };

  const deployed = await deployNftZk(providers, privateState);
  const address = deployed.deployTxData.public.contractAddress;
  console.log(`contract deployed: ${address}`);

  // My coin public key — what ownPublicKey().bytes resolves to in-circuit.
  const myPkHex = providers.walletProvider.getCoinPublicKey();
  const myPk = Uint8Array.from(Buffer.from(myPkHex, "hex"));
  console.log(`my coin pubkey: ${myPkHex} (${myPk.length} bytes)`);

  // Off-chain: recipient computes the claim commitment to hand to the minter.
  const claimCommitment = pureCircuits.commitClaim(myPk, privateState.claim_salt);
  console.log(`claim commitment: ${hx(claimCommitment)}`);

  // 1) Admin mints the token into the pending claim (with metadata).
  const mintRes = await deployed.callTx.mintAdmin(claimCommitment, TOKEN, URI);
  console.log(`mintAdmin landed @ block ${mintRes.public.blockHeight} (real ZK proof verified on-chain)`);

  // 2) Recipient claims it (proves pubkey + salt; takes ownership under per-token commitment).
  const claimRes = await deployed.callTx.claim(TOKEN);
  console.log(`claim landed @ block ${claimRes.public.blockHeight} (real ZK proof verified on-chain)`);

  // 3) Owner burns it.
  const burnRes = await deployed.callTx.burn(TOKEN);
  console.log(`burn landed @ block ${burnRes.public.blockHeight} (real ZK proof verified on-chain)`);

  // Best-effort on-chain confirmation via the indexer (read API may vary by SDK version).
  try {
    const st = await providers.publicDataProvider.queryContractState(address);
    if (st) {
      const led: any = ledgerOf(((st as any).data ?? st));
      const exists = led?.tokenOwner?.member?.(TOKEN);
      console.log(`indexer read: token ${TOKEN} still owned after burn? ${exists} (expected false)`);
    }
  } catch (e) {
    console.log(`(indexer read skipped: ${(e as Error).message})`);
  }

  console.log("");
  console.log("DEMO OK — nft-zk deployed + mint -> claim -> burn, all with real ZK proofs");
  console.log("          verified on-chain by the local Midnight ledger.");
  process.exit(0);
};

main().catch((e) => {
  console.error("DEMO FAILED:", e);
  process.exit(1);
});
