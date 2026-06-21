// midnight-js provider wiring (adapted from ZKCaptcha's harness / example-counter, Apache-2.0).
// SPDX-License-Identifier: Apache-2.0
import { Buffer } from "node:buffer";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import type { MidnightProvider, WalletProvider } from "@midnight-ntwrk/midnight-js/types";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js/types";
import type { ProvableCircuitId } from "@midnight-ntwrk/compact-js";
import * as Rx from "rxjs";
import type { HarnessConfig } from "./config.js";
import type { WalletContext } from "./wallet.js";
import {
  type NftZkContract,
  type NftZkPrivateState,
  NftZkPrivateStateId,
  zkConfigPath,
} from "./contract.js";

export type NftZkCircuits = ProvableCircuitId<NftZkContract>;
export type NftZkProviders = MidnightProviders<
  NftZkCircuits,
  typeof NftZkPrivateStateId,
  NftZkPrivateState
>;

/**
 * Sign all unshielded offers in a transaction's intents with the correct proof marker.
 * Works around a wallet-SDK bug where signRecipe hardcodes 'pre-proof'. Verbatim from
 * example-counter / the ZKCaptcha harness.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, unknown> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: "proof" | "pre-proof"
): void => {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment) as
      | {
          serialize(): Uint8Array;
          signatureData(s: number): Uint8Array;
          fallibleUnshieldedOffer?: {
            inputs: ledger.UtxoSpend[];
            signatures: { at(i: number): ledger.Signature | undefined };
            addSignatures(sigs: ledger.Signature[]): unknown;
          };
          guaranteedUnshieldedOffer?: {
            inputs: ledger.UtxoSpend[];
            signatures: { at(i: number): ledger.Signature | undefined };
            addSignatures(sigs: ledger.Signature[]): unknown;
          };
        }
      | undefined;
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<
      ledger.SignatureEnabled,
      ledger.Proofish,
      ledger.PreBinding
    >("signature", proofMarker, "pre-binding", intent.serialize());

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) =>
          cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) =>
          cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }
    tx.intents.set(segment, cloned);
  }
};

export const createWalletAndMidnightProvider = async (
  ctx: WalletContext
): Promise<WalletProvider & MidnightProvider> => {
  const state = await Rx.firstValueFrom(
    ctx.wallet.state().pipe(Rx.filter((s) => s.isSynced))
  );
  return {
    getCoinPublicKey() {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey() {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl?) {
      const recipe = await ctx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: ctx.shieldedSecretKeys, dustSecretKey: ctx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) }
      );
      const signFn = (payload: Uint8Array) => ctx.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, "proof");
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, "pre-proof");
      }
      return ctx.wallet.finalizeRecipe(recipe);
    },
    submitTx(tx) {
      return ctx.wallet.submitTransaction(tx) as ReturnType<MidnightProvider["submitTx"]>;
    },
  };
};

export const configureProviders = async (
  ctx: WalletContext,
  config: HarnessConfig
): Promise<NftZkProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
  const zkConfigProvider = new NodeZkConfigProvider<NftZkCircuits>(zkConfigPath);
  const accountId = walletAndMidnightProvider.getCoinPublicKey();
  const storagePassword = `${Buffer.from(accountId, "hex").toString("base64")}!`;
  return {
    privateStateProvider: levelPrivateStateProvider<typeof NftZkPrivateStateId>({
      privateStateStoreName: "midnight-nft-private-state",
      accountId,
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};
