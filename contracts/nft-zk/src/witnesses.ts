// This file is part of midnightntwrk/example-nft-contracts (vendored, Apache-2.0),
// adapted for the Atlantis `midnight-nft` foundation. SPDX-License-Identifier: Apache-2.0

import {
  Contract as ContractType,
  Ledger,
  Witnesses
} from "../../managed/nft-zk/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type Contract<T, W extends Witnesses<T> = Witnesses<T>> = ContractType<T, W>;

// Private state for the NFT-ZK contract (claim model).
//   local_secret   : per-user secret for self-custody (owner commitments).
//   claim_salt     : per-user secret folded into a claim commitment when receiving.
//   adminSecretKey : deployer-only key; contract stores only its derived public key.
//   No shared_secret — that was the de-anonymisation hole this rework removes.
export type NftZkPrivateState = {
  readonly local_secret: Uint8Array;
  readonly claim_salt: Uint8Array;
  readonly adminSecretKey: Uint8Array;
};

export function createNftZkPrivateState(
  local_secret: Uint8Array,
  claim_salt: Uint8Array,
  adminSecretKey: Uint8Array
): NftZkPrivateState {
  return { local_secret, claim_salt, adminSecretKey };
}

export const witnesses = {
  getLocalSecret: ({
    privateState
  }: WitnessContext<Ledger, NftZkPrivateState>): [NftZkPrivateState, Uint8Array] => {
    if (privateState.local_secret) {
      return [privateState, privateState.local_secret];
    }
    throw new Error("No local secret found.");
  },
  getClaimSalt: ({
    privateState
  }: WitnessContext<Ledger, NftZkPrivateState>): [NftZkPrivateState, Uint8Array] => {
    if (privateState.claim_salt) {
      return [privateState, privateState.claim_salt];
    }
    throw new Error("No claim salt found.");
  },
  getAdminSecret: ({
    privateState
  }: WitnessContext<Ledger, NftZkPrivateState>): [NftZkPrivateState, { bytes: Uint8Array }] => {
    if (privateState.adminSecretKey) {
      return [privateState, { bytes: privateState.adminSecretKey }];
    }
    throw new Error("No admin secret key found.");
  }
};
