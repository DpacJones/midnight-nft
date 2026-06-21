// Endpoints for the local Midnight chain defined in
// tooling/midnight/docker-compose.yml. Host ports are fixed there, so
// these are constants rather than dynamically discovered.

export interface HarnessConfig {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

export const standaloneConfig: HarnessConfig = {
  indexer: "http://127.0.0.1:8088/api/v3/graphql",
  indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
  node: "http://127.0.0.1:9944",
  proofServer: "http://127.0.0.1:6300",
};

// The shared public preprod testnet. Node and indexer are remote; the
// proof server stays LOCAL by design — proving consumes the private
// witness (the trust set), which must never leave this machine.
// Endpoints follow midnightntwrk/example-counter's PreprodConfig;
// verify them if Midnight relocates preprod infrastructure.
export const preprodConfig: HarnessConfig = {
  indexer: "https://indexer.preprod.midnight.network/api/v3/graphql",
  indexerWS: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
  node: "https://rpc.preprod.midnight.network",
  proofServer: "http://127.0.0.1:6300",
};

// Seed of the wallet pre-funded in the genesis block of a local dev
// node (CFG_PRESET=dev). Standalone use only — it has no value on any
// real network, and preprod has no genesis wallet.
export const GENESIS_MINT_WALLET_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";

// Public faucet that funds a preprod wallet's unshielded address with
// test NIGHT (tNight).
export const PREPROD_FAUCET_URL = "https://faucet.preprod.midnight.network/";
