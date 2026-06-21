// Deploy/join helpers for the nft-zk contract. SPDX-License-Identifier: Apache-2.0
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  deployContract,
  findDeployedContract,
} from "@midnight-ntwrk/midnight-js/contracts";
import type {
  DeployedContract,
  FoundContract,
} from "@midnight-ntwrk/midnight-js/contracts";
import {
  ContractCtor,
  type NftZkContract,
  type NftZkPrivateState,
  NftZkPrivateStateId,
  witnesses,
  zkConfigPath,
} from "./contract.js";
import type { NftZkProviders } from "./providers.js";

export type DeployedNftZk =
  | DeployedContract<NftZkContract>
  | FoundContract<NftZkContract>;

export const nftZkCompiledContract = CompiledContract.make(
  "nft-zk",
  ContractCtor
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath)
);

/** Deploy a fresh nft-zk contract. The deployer becomes the admin (via ownPublicKey). */
export const deployNftZk = async (
  providers: NftZkProviders,
  initialPrivateState: NftZkPrivateState
): Promise<DeployedNftZk> =>
  deployContract(providers, {
    compiledContract: nftZkCompiledContract,
    privateStateId: NftZkPrivateStateId,
    initialPrivateState,
  });

/** Re-attach to an already-deployed nft-zk contract. */
export const joinNftZk = async (
  providers: NftZkProviders,
  contractAddress: string,
  initialPrivateState: NftZkPrivateState
): Promise<DeployedNftZk> =>
  findDeployedContract(providers, {
    contractAddress,
    compiledContract: nftZkCompiledContract,
    privateStateId: NftZkPrivateStateId,
    initialPrivateState,
  });
