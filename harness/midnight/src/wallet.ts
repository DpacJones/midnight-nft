// Wallet construction for the Midnight integration harness.
//
// Adapted from midnightntwrk/example-counter's counter-cli/src/api.ts
// (Apache-2.0). Kept deliberately close to that known-working SDK glue
// — the wallet SDK surface is intricate and version-sensitive, so this
// is a port, not a reinvention. Trimmed to what the harness needs:
// no faucet messaging, no console spinners.

import { Buffer } from "node:buffer";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import type { HarnessConfig } from "./config.js";

// Apollo's GraphQL subscriptions (wallet sync) need a global WebSocket.
// @ts-expect-error -- assigning the ws implementation onto globalThis
globalThis.WebSocket = WebSocket;

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: HarnessConfig) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, "ws")),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: HarnessConfig) => ({
  networkId: getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  txHistoryStorage: new InMemoryTransactionHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: HarnessConfig) => ({
  networkId: getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: indexer, indexerWsUrl: indexerWS },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, "ws")),
});

// Derive HD wallet keys for the Zswap, NightExternal and Dust roles
// from a hex seed (BIP-44 style, account 0, index 0).
const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hdWallet.type !== "seedOk") throw new Error("Failed to initialize HDWallet from seed");
  const derived = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derived.type !== "keysDerived") throw new Error("Failed to derive keys");
  hdWallet.hdWallet.clear();
  return derived.keys;
};

/** Resolve once the wallet has synced with the node. */
export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
    ),
  );

/** Resolve once the wallet holds a non-zero unshielded (NIGHT) balance. */
export const waitForFunds = (wallet: WalletFacade): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded.balances[unshieldedToken().raw] ?? 0n),
      Rx.filter((b) => b > 0n),
    ),
  );

/**
 * Register NIGHT UTXOs for dust generation. DUST is Midnight's
 * non-transferable fee token; UTXOs must be explicitly designated
 * before they generate it. Resolves once DUST balance is positive.
 */
export const ensureDust = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s) => s.isSynced)));
  if (state.dust.availableCoins.length > 0 && state.dust.balance(new Date()) > 0n) return;

  const nightUtxos = state.unshielded.availableCoins.filter(
    (c: { meta?: { registeredForDustGeneration?: boolean } }) =>
      c.meta?.registeredForDustGeneration !== true,
  );
  if (nightUtxos.length > 0) {
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      unshieldedKeystore.getPublicKey(),
      (payload) => unshieldedKeystore.signData(payload),
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);
  }
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.filter((s) => s.dust.balance(new Date()) > 0n),
    ),
  );
};

export interface BuildWalletOptions {
  // When true, return as soon as the wallet has synced — do not block
  // waiting for a non-zero balance. Needed on preprod, where the
  // wallet is unfunded until its address is faucet-funded by hand;
  // the caller prints the address first, then waits for funds itself.
  readonly skipFundsWait?: boolean;
}

/** Build a wallet from a hex seed; sync, and (unless skipped) wait for funds. */
export const buildWallet = async (
  config: HarnessConfig,
  seed: string,
  options: BuildWalletOptions = {},
): Promise<WalletContext> => {
  const keys = deriveKeysFromSeed(seed);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    ...buildShieldedConfig(config),
    ...buildUnshieldedConfig(config),
    ...buildDustConfig(config),
  };
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      ),
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  await waitForSync(wallet);
  if (!options.skipFundsWait) {
    const synced = await Rx.firstValueFrom(
      wallet.state().pipe(Rx.filter((s) => s.isSynced)),
    );
    const balance = synced.unshielded.balances[unshieldedToken().raw] ?? 0n;
    if (balance === 0n) await waitForFunds(wallet);
  }

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};
