// Wiring for the compiled nft-zk Compact contract (claim model, v1.1).
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import * as NftZk from "../contract/managed/contract/index.js";

const here = dirname(fileURLToPath(import.meta.url));

// Directory holding the compiled ZK assets (keys/, zkir/, contract/).
export const zkConfigPath = resolve(here, "../contract/managed");

export type NftZkContract = NftZk.Contract<NftZkPrivateState>;
export const ContractCtor = NftZk.Contract;
export const ledgerOf = NftZk.ledger;
export const pureCircuits = NftZk.pureCircuits;

export const NftZkPrivateStateId = "midnightNftZkPrivateState";

// Off-chain private state: the per-user secrets. Never appears in a tx or ledger field.
export interface NftZkPrivateState {
  readonly local_secret: Uint8Array; // self-custody / owner commitments
  readonly claim_salt: Uint8Array; // folded into claim commitments when receiving
}

export const witnesses = {
  getLocalSecret(
    ctx: WitnessContext<NftZk.Ledger, NftZkPrivateState>
  ): [NftZkPrivateState, Uint8Array] {
    return [ctx.privateState, ctx.privateState.local_secret];
  },
  getClaimSalt(
    ctx: WitnessContext<NftZk.Ledger, NftZkPrivateState>
  ): [NftZkPrivateState, Uint8Array] {
    return [ctx.privateState, ctx.privateState.claim_salt];
  },
};
