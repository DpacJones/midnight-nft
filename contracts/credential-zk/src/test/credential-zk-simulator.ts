// Multi-party simulator for the MIP-A v3 Soulbound Credential Primitive.
// SPDX-License-Identifier: Apache-2.0
//
// Maintains an off-chain Indexed Merkle Tree (IMT) mirror of the on-chain revoked set so it
// can compute the predecessor ("low") leaf that brackets a handle. The on-chain tree stores
// only leaf hashes; the (value,next) preimages are public knowledge, modelled here.

import {
  type CircuitContext,
  sampleContractAddress,
  createConstructorContext,
  createCircuitContext,
  type ContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
  pureCircuits,
} from "../../../managed/credential-zk/contract/index.js";
import {
  type CredentialZkPrivateState,
  createCredentialZkPrivateState,
  witnesses,
} from "../witnesses.js";
import { TextEncoder } from "util";

// --- helpers -------------------------------------------------------------------------------

export function strBytes(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  const bytes = new Uint8Array(32);
  bytes.set(encoded.slice(0, 32));
  return bytes;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
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

export type User = {
  name: string;
  pubkey: string; // hex coin public key (context identity)
  profileTag: Uint8Array;
  holderPk: Uint8Array;
  holderSecret: Uint8Array;
  nonce: Uint8Array;
  handle: bigint; // Uint<248> revocation handle (issuer+holder shared, unlinkable on-chain)
  issuerSecret: Uint8Array;
};

// `handle` is assigned explicitly per user so tests can exercise specific IMT orderings.
export function makeUser(
  name: string,
  handle: bigint,
  profileTag?: Uint8Array,
): User {
  return {
    name,
    pubkey: pubkeyHex(name),
    profileTag: profileTag ?? pureCircuits.walletProfileTag(),
    holderPk: strBytes(name + ":pk"),
    holderSecret: strBytes(name + ":secret"),
    nonce: strBytes(name + ":nonce"),
    handle,
    issuerSecret: strBytes(name + ":issuer"),
  };
}

type ImtLeaf = { value: bigint; next: bigint };

export class CredentialZkSimulator {
  readonly contract: Contract<CredentialZkPrivateState>;
  circuitContext: CircuitContext<CredentialZkPrivateState>;
  readonly address: ContractAddress;
  readonly issuerUser: User;

  // off-chain IMT mirror (index-aligned with the on-chain revoked set)
  private imt: ImtLeaf[] = [{ value: 0n, next: 0n }]; // sentinel at index 0
  // index of each issued commitment in the issued tree (hex(cm) -> index)
  private issuedIndex = new Map<string, bigint>();
  private issuedNext = 0n;

  constructor(issuerUser: User, domain: Uint8Array, schemaId: Uint8Array) {
    this.issuerUser = issuerUser;
    this.contract = new Contract<CredentialZkPrivateState>(witnesses);
    this.address = sampleContractAddress();
    const init = this.contract.initialState(
      createConstructorContext(
        createCredentialZkPrivateState({
          issuer_secret: issuerUser.issuerSecret,
        }),
        issuerUser.pubkey,
      ),
      domain,
      schemaId,
    );
    this.circuitContext = createCircuitContext(
      this.address,
      issuerUser.pubkey,
      init.currentContractState,
      init.currentPrivateState,
    );
  }

  getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  // Rebuild the circuit context to act AS `user` with the supplied private-state overrides,
  // preserving current on-chain state.
  private as(
    user: User,
    overrides: Partial<CredentialZkPrivateState> = {},
  ): void {
    this.circuitContext = createCircuitContext(
      this.address,
      user.pubkey,
      this.circuitContext.currentQueryContext.state,
      createCredentialZkPrivateState({
        issuer_secret: user.issuerSecret,
        profile_tag: user.profileTag,
        holder_pk: user.holderPk,
        holder_secret: user.holderSecret,
        revocation_handle: user.handle,
        credential_nonce: user.nonce,
        ...overrides,
      }),
    );
  }

  // --- off-chain commitment helper (the holder builds this and hands it to issue) ---
  commitmentFor(user: User): Uint8Array {
    const led = this.getLedger();
    return pureCircuits.buildCredentialCommitment(
      user.profileTag,
      led.issuerNamespace,
      led.credentialDomain,
      user.holderPk,
      user.holderSecret,
      user.handle,
      user.nonce,
    );
  }

  // find the predecessor leaf bracketing `h` in the current IMT mirror
  private findLow(h: bigint): { value: bigint; next: bigint; index: bigint } {
    for (let i = 0; i < this.imt.length; i++) {
      const { value, next } = this.imt[i];
      if (value < h && (next === 0n || h < next)) {
        return { value, next, index: BigInt(i) };
      }
    }
    throw new Error(
      `findLow: no bracketing leaf for handle ${h} (already revoked?)`,
    );
  }

  // --- issuer actions ---
  issue(commitment: Uint8Array): void {
    this.issueAs(this.issuerUser, commitment);
  }
  issueAs(actor: User, commitment: Uint8Array): void {
    this.as(actor);
    this.circuitContext = this.contract.impureCircuits.issue(
      this.circuitContext,
      commitment,
    ).context;
    // record the leaf index only after a successful insert
    this.issuedIndex.set(toHex(commitment), this.issuedNext);
    this.issuedNext += 1n;
  }

  revoke(handle: bigint): void {
    this.revokeAs(this.issuerUser, handle);
  }
  revokeAs(actor: User, handle: bigint): void {
    const low = this.findLow(handle);
    const oldNext = low.next; // predecessor's current successor (pre-splice)
    // thread the predecessor coordinates so getRevokeLowPath can fetch its path
    this.as(actor, {
      low_value: low.value,
      low_next: oldNext,
      low_index: low.index,
    });
    this.circuitContext = this.contract.impureCircuits.revoke(
      this.circuitContext,
      handle,
      low.value,
      oldNext,
      low.index,
    ).context;
    // mirror the splice
    this.imt[Number(low.index)] = { value: low.value, next: handle };
    this.imt.push({ value: handle, next: oldNext });
  }

  proposeIssuerAs(actor: User, newIssuer: User): void {
    this.as(actor);
    const newPk = pureCircuits.deriveIssuerPk({
      bytes: newIssuer.issuerSecret,
    });
    this.circuitContext = this.contract.impureCircuits.proposeIssuer(
      this.circuitContext,
      newPk,
    ).context;
  }

  acceptIssuerAs(actor: User): void {
    this.as(actor);
    this.circuitContext = this.contract.impureCircuits.acceptIssuer(
      this.circuitContext,
    ).context;
  }

  // --- holder proofs ---
  proveIssuedAs(holder: User): void {
    const cm = this.commitmentFor(holder);
    const idx = this.issuedIndex.get(toHex(cm));
    if (idx === undefined) {
      throw new Error("proveIssuedAs: holder has no issued credential.");
    }
    this.as(holder, { issued_index: idx });
    this.circuitContext = this.contract.impureCircuits.proveIssued(
      this.circuitContext,
    ).context;
  }

  proveNotRevokedAs(holder: User): void {
    const low = this.findLow(holder.handle); // throws if the handle is revoked
    this.as(holder, {
      low_value: low.value,
      low_next: low.next,
      low_index: low.index,
    });
    this.circuitContext = this.contract.impureCircuits.proveNotRevoked(
      this.circuitContext,
    ).context;
  }

  // Adversarial: force a non-revocation proof with caller-chosen low-leaf coordinates. Used to
  // confirm the CIRCUIT (not just the simulator) rejects a forged bracket for a revoked handle.
  proveNotRevokedForged(
    holder: User,
    lowValue: bigint,
    lowNext: bigint,
    lowIndex: bigint,
  ): void {
    this.as(holder, {
      low_value: lowValue,
      low_next: lowNext,
      low_index: lowIndex,
    });
    this.circuitContext = this.contract.impureCircuits.proveNotRevoked(
      this.circuitContext,
    ).context;
  }

  // --- reads ---
  issuerPk(): Uint8Array {
    return this.getLedger().issuer.bytes;
  }
  revokedCount(): bigint {
    return this.getLedger().revokedCount;
  }
}
