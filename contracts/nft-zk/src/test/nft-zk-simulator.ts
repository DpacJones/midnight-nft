// Multi-party simulator for the claim-model NftZk. SPDX-License-Identifier: Apache-2.0
import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
  type ContractAddress
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits
} from "../../../managed/nft-zk/contract/index.js";
import {
  type NftZkPrivateState,
  createNftZkPrivateState,
  witnesses
} from "../witnesses.js";
import { fromHex } from "@midnight-ntwrk/midnight-js-utils";
import { TextEncoder } from "util";

const ADMIN_SECRET = strBytes("the_real_admin_secret");
const DUMMY_SECRET = strBytes("not_the_admin");

export type User = {
  name: string;
  pubkey: string; // hex CoinPublicKey
  localSecret: Uint8Array;
  claimSalt: Uint8Array;
};

function strBytes(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const bytes = new Uint8Array(32);
  bytes.set(encoded.slice(0, 32));
  return bytes;
}

function pubkeyHex(name: string): string {
  const encoded = new TextEncoder().encode(name);
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    const byte =
      i < encoded.length
        ? encoded[i]
        : (name.charCodeAt(i % name.length) + i) % 256;
    hex.push(byte.toString(16).padStart(2, "0"));
  }
  return hex.join("");
}

export function makeUser(name: string): User {
  return {
    name,
    pubkey: pubkeyHex(name),
    localSecret: strBytes(name + ":local"),
    claimSalt: strBytes(name + ":salt")
  };
}

function pkBytes(user: User): Uint8Array {
  const bytes = fromHex(user.pubkey.padStart(64, "0"));
  const out = new Uint8Array(32);
  out.set(bytes.slice(0, 32));
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export class NftZkSimulator {
  readonly contract: Contract<NftZkPrivateState>;
  circuitContext: CircuitContext<NftZkPrivateState>;
  readonly address: ContractAddress;
  readonly admin: User;

  constructor(admin: User) {
    this.admin = admin;
    this.contract = new Contract<NftZkPrivateState>(witnesses);
    this.address = sampleContractAddress();
    const init = this.contract.initialState(
      createConstructorContext(
        createNftZkPrivateState(admin.localSecret, admin.claimSalt, ADMIN_SECRET),
        admin.pubkey
      )
    );
    this.circuitContext = createCircuitContext(
      this.address,
      admin.pubkey,
      init.currentContractState,
      init.currentPrivateState
    );
  }

  // Rebuild the context to act AS `user`, preserving current on-chain state.
  private as(user: User, isAdmin = false): void {
    const ps = createNftZkPrivateState(
      user.localSecret,
      user.claimSalt,
      isAdmin ? ADMIN_SECRET : DUMMY_SECRET
    );
    this.circuitContext = createCircuitContext(
      this.address,
      user.pubkey,
      this.circuitContext.currentQueryContext.state,
      ps
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  // --- off-chain commitment helpers (what a recipient/owner computes locally) ---
  claimCommitment(user: User): Uint8Array {
    return pureCircuits.commitClaim(pkBytes(user), user.claimSalt);
  }
  claimCommitmentWithSalt(user: User, salt: Uint8Array): Uint8Array {
    return pureCircuits.commitClaim(pkBytes(user), salt);
  }
  ownerCommitment(user: User): Uint8Array {
    return pureCircuits.commitOwner(pkBytes(user), user.localSecret);
  }

  // --- writes (impure) ---
  mintAdmin(claimCommitment: Uint8Array, tokenId: bigint): void {
    this.as(this.admin, true);
    this.circuitContext = this.contract.impureCircuits.mintAdmin(
      this.circuitContext,
      claimCommitment,
      tokenId
    ).context;
  }
  mintAdminAs(actor: User, claimCommitment: Uint8Array, tokenId: bigint): void {
    this.as(actor, false); // non-admin actor -> should be rejected by the contract
    this.circuitContext = this.contract.impureCircuits.mintAdmin(
      this.circuitContext,
      claimCommitment,
      tokenId
    ).context;
  }
  release(owner: User, tokenId: bigint, claimCommitment: Uint8Array): void {
    this.as(owner);
    this.circuitContext = this.contract.impureCircuits.release(
      this.circuitContext,
      tokenId,
      claimCommitment
    ).context;
  }
  claim(recipient: User, tokenId: bigint): void {
    this.as(recipient);
    this.circuitContext = this.contract.impureCircuits.claim(
      this.circuitContext,
      tokenId
    ).context;
  }
  burn(owner: User, tokenId: bigint): void {
    this.as(owner);
    this.circuitContext = this.contract.impureCircuits.burn(
      this.circuitContext,
      tokenId
    ).context;
  }

  // --- reads ---
  ownerOf(tokenId: bigint): Uint8Array {
    return this.contract.circuits.ownerOf(this.circuitContext, tokenId).result;
  }
  pendingOf(tokenId: bigint): Uint8Array {
    return this.contract.circuits.pendingOf(this.circuitContext, tokenId).result;
  }
  tokenExists(tokenId: bigint): boolean {
    return this.contract.circuits.tokenExists(this.circuitContext, tokenId).result;
  }
  balanceOf(user: User): bigint {
    this.as(user);
    return this.contract.circuits.balanceOf(this.circuitContext).result;
  }
}
