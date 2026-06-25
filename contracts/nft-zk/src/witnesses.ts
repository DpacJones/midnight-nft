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
//   local_secret : per-user secret for self-custody (owner commitments).
//   claim_salt   : per-user secret folded into a claim commitment when receiving
//                  (use a FRESH salt per incoming transfer).
//   admin_secret : the admin private key (M1 fix). The contract derives the admin PUBLIC
//                  key from this via deriveAdminPublicKey() and stores only the public key
//                  on the ledger; admin authorization = proof of knowledge of this secret.
//                  Held confidentially by the prover and never disclosed. Non-admin provers
//                  simply supply a secret that does not derive to the on-chain admin key.
export type NftZkPrivateState = {
  readonly local_secret: Uint8Array;
  readonly claim_salt: Uint8Array;
  readonly admin_secret: Uint8Array;
};

export function createNftZkPrivateState(
  local_secret: Uint8Array,
  claim_salt: Uint8Array,
  admin_secret: Uint8Array
): NftZkPrivateState {
  return { local_secret, claim_salt, admin_secret };
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
  // Supplies the admin private key as an AdminSecretKey struct ({ bytes }). The contract
  // re-derives the admin public key and compares it to the on-chain admin key.
  localSecretKey: ({
    privateState
  }: WitnessContext<Ledger, NftZkPrivateState>): [
    NftZkPrivateState,
    { bytes: Uint8Array }
  ] => {
    if (privateState.admin_secret) {
      return [privateState, { bytes: privateState.admin_secret }];
    }
    throw new Error("No admin secret found.");
  }
};
