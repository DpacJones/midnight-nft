// Witness implementations for the MIP-A v3 Soulbound Credential Primitive.
// SPDX-License-Identifier: Apache-2.0
//
// Two roles share one witness surface (rebuilt per actor by the simulator):
//   * ISSUER  : supplies `issuerSecretKey()` (proof of authority) and, for revoke, the
//               predecessor coordinates (low_value/low_next) used to fetch its Merkle path.
//   * HOLDER  : supplies the credential opening and the membership / non-membership aux data.
//
// Merkle paths are pulled live from the on-chain tree via `context.ledger` using
// pathForLeaf(index, leaf) (the find-by-value variant is unusable: the on-chain runtime tree
// is not auto-rehashed, so it returns undefined). Leaf indices and the (value,next) preimages
// of the revoked set — public knowledge, since the tree stores only hashes — are threaded in
// from private state by the simulator per call.

import {
  Contract as ContractType,
  Ledger,
  Witnesses,
  pureCircuits,
} from "../../managed/credential-zk/contract/index.js";
import { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type Contract<T, W extends Witnesses<T> = Witnesses<T>> = ContractType<
  T,
  W
>;

// MerkleTreePath shape (matches both the witness return type and ledger.findPathForLeaf).
type MerklePath = {
  leaf: Uint8Array;
  path: { sibling: { field: bigint }; goes_left: boolean }[];
};

export type CredentialZkPrivateState = {
  // issuer authority
  readonly issuer_secret: Uint8Array;
  // holder credential opening
  readonly profile_tag: Uint8Array;
  readonly holder_pk: Uint8Array;
  readonly holder_secret: Uint8Array;
  readonly revocation_handle: bigint;
  readonly credential_nonce: Uint8Array;
  // holder identity secret behind holder_pk (WALLET profile only; deriveUserPk(secret)==pk)
  readonly holder_identity_secret: Uint8Array;
  // predecessor / low-leaf coordinates for the active IMT path lookup (set per call)
  readonly low_value: bigint;
  readonly low_next: bigint;
  readonly low_index: bigint;
  // index of the holder's commitment in the issued tree (set per call)
  readonly issued_index: bigint;
};

export function createCredentialZkPrivateState(
  fields: Partial<CredentialZkPrivateState>,
): CredentialZkPrivateState {
  const z32 = new Uint8Array(32);
  return {
    issuer_secret: fields.issuer_secret ?? z32,
    profile_tag: fields.profile_tag ?? z32,
    holder_pk: fields.holder_pk ?? z32,
    holder_secret: fields.holder_secret ?? z32,
    revocation_handle: fields.revocation_handle ?? 0n,
    credential_nonce: fields.credential_nonce ?? z32,
    holder_identity_secret: fields.holder_identity_secret ?? z32,
    low_value: fields.low_value ?? 0n,
    low_next: fields.low_next ?? 0n,
    low_index: fields.low_index ?? 0n,
    issued_index: fields.issued_index ?? 0n,
  };
}

function rebuildCommitment(
  ledger: Ledger,
  ps: CredentialZkPrivateState,
): Uint8Array {
  return pureCircuits.buildCredentialCommitment(
    ps.profile_tag,
    ledger.issuerNamespace,
    ledger.credentialDomain,
    ps.holder_pk,
    ps.holder_secret,
    ps.revocation_handle,
    ps.credential_nonce,
  );
}

export const witnesses = {
  issuerSecretKey: ({
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    { bytes: Uint8Array },
  ] => {
    return [privateState, { bytes: privateState.issuer_secret }];
  },

  holderIdentitySecret: ({
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    Uint8Array,
  ] => {
    return [privateState, privateState.holder_identity_secret];
  },

  getCredentialOpening: ({
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    {
      profileTag: Uint8Array;
      holderPk: Uint8Array;
      holderSecret: Uint8Array;
      revocationHandle: bigint;
      credentialNonce: Uint8Array;
    },
  ] => {
    return [
      privateState,
      {
        profileTag: privateState.profile_tag,
        holderPk: privateState.holder_pk,
        holderSecret: privateState.holder_secret,
        revocationHandle: privateState.revocation_handle,
        credentialNonce: privateState.credential_nonce,
      },
    ];
  },

  getIssuedPath: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    MerklePath,
  ] => {
    const cm = rebuildCommitment(ledger, privateState);
    // pathForLeaf(index, leaf) is used instead of findPathForLeaf because the on-chain
    // runtime tree is not auto-rehashed, so the leaf-search variant returns undefined.
    const path = ledger.issuedCredentials.pathForLeaf(
      privateState.issued_index,
      cm,
    );
    return [privateState, path as unknown as MerklePath];
  },

  getNonRevLow: ({
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    { value: bigint; next: bigint },
  ] => {
    return [
      privateState,
      { value: privateState.low_value, next: privateState.low_next },
    ];
  },

  getNonRevPath: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    MerklePath,
  ] => {
    const leaf = pureCircuits.revLeafHash(
      privateState.low_value,
      privateState.low_next,
    );
    const path = ledger.revokedSet.pathForLeaf(privateState.low_index, leaf);
    return [privateState, path as unknown as MerklePath];
  },

  getRevokeLowPath: ({
    ledger,
    privateState,
  }: WitnessContext<Ledger, CredentialZkPrivateState>): [
    CredentialZkPrivateState,
    MerklePath,
  ] => {
    const leaf = pureCircuits.revLeafHash(
      privateState.low_value,
      privateState.low_next,
    );
    const path = ledger.revokedSet.pathForLeaf(privateState.low_index, leaf);
    return [privateState, path as unknown as MerklePath];
  },
};
