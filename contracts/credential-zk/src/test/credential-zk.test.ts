// MIP-A v3 Soulbound Credential Primitive — tests. SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import {
  CredentialZkSimulator,
  makeUser,
  strBytes,
  toHex,
  type User,
} from "./credential-zk-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { pureCircuits } from "../../../managed/credential-zk/contract/index.js";

setNetworkId("undeployed");

const DOMAIN = strBytes("mipa:domain:test");
const SCHEMA = strBytes("mipa:schema:v1");

// distinct 248-bit handles chosen to exercise several IMT orderings
const issuer = makeUser("Issuer", 0n); // issuer's own handle unused
const alice = makeUser("Alice", 5000n);
const bob = makeUser("Bob", 9000n);
const carol = makeUser("Carol", 3000n);
const dave = makeUser("Dave", 7000n);

function newSim(): CredentialZkSimulator {
  return new CredentialZkSimulator(issuer, DOMAIN, SCHEMA);
}

describe("MIP-A: issuance and membership", () => {
  it("issuer issues a holder-built commitment; holder proves membership", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.proveIssuedAs(alice)).not.toThrow();
  });

  it("a holder who was never issued cannot prove membership", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.proveIssuedAs(bob)).toThrow();
  });

  it("two credentials for the SAME holder are distinct on-chain leaves", () => {
    const sim = newSim();
    // same holderPk/secret, different nonce + handle -> different hiding commitment
    const aliceCredA: User = {
      ...alice,
      nonce: strBytes("Alice:nonceA"),
      handle: 5000n,
    };
    const aliceCredB: User = {
      ...alice,
      nonce: strBytes("Alice:nonceB"),
      handle: 5001n,
    };
    const cmA = sim.commitmentFor(aliceCredA);
    const cmB = sim.commitmentFor(aliceCredB);
    expect(toHex(cmA)).not.toBe(toHex(cmB));
    sim.issue(cmA);
    sim.issue(cmB);
    expect(() => sim.proveIssuedAs(aliceCredA)).not.toThrow();
    expect(() => sim.proveIssuedAs(aliceCredB)).not.toThrow();
  });
});

describe("MIP-A: issuer-only enforcement", () => {
  it("a non-issuer cannot issue", () => {
    const sim = newSim();
    expect(() => sim.issueAs(carol, sim.commitmentFor(alice))).toThrow();
  });

  it("a non-issuer cannot revoke", () => {
    const sim = newSim();
    expect(() => sim.revokeAs(carol, alice.handle)).toThrow();
  });

  it("a forged issuer secret is rejected (cannot satisfy the proof-of-secret gate)", () => {
    const sim = newSim();
    const forger: User = {
      ...carol,
      issuerSecret: strBytes("not-the-issuer-secret"),
    };
    expect(() => sim.issueAs(forger, sim.commitmentFor(alice))).toThrow();
  });
});

describe("MIP-A: private non-revocation (Indexed Merkle Tree)", () => {
  it("a never-revoked holder proves non-revocation (empty revoked set)", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.proveNotRevokedAs(alice)).not.toThrow();
  });

  it("after revoking the handle, the non-revocation proof fails", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.proveNotRevokedAs(alice)).not.toThrow();
    sim.revoke(alice.handle);
    expect(() => sim.proveNotRevokedAs(alice)).toThrow();
  });

  it("revoking one holder does not affect another holder's non-revocation proof", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.issue(sim.commitmentFor(bob));
    sim.revoke(alice.handle);
    expect(() => sim.proveNotRevokedAs(alice)).toThrow();
    expect(() => sim.proveNotRevokedAs(bob)).not.toThrow();
  });

  it("handles many revocations in mixed order and keeps the IMT consistent", () => {
    const sim = newSim();
    [alice, bob, carol, dave].forEach((u) => sim.issue(sim.commitmentFor(u)));
    // revoke carol(3000) then bob(9000) then dave(7000) — exercises both ends and the middle
    sim.revoke(carol.handle);
    sim.revoke(bob.handle);
    sim.revoke(dave.handle);
    expect(() => sim.proveNotRevokedAs(carol)).toThrow();
    expect(() => sim.proveNotRevokedAs(bob)).toThrow();
    expect(() => sim.proveNotRevokedAs(dave)).toThrow();
    // alice (5000) was never revoked and sits between carol and dave -> still valid
    expect(() => sim.proveNotRevokedAs(alice)).not.toThrow();
    // sentinel + 4 revocations (each adds one leaf) = 4 (count starts at 1 for sentinel)
    expect(sim.revokedCount()).toBe(4n);
  });

  it("the CIRCUIT rejects a forged bracket for a revoked handle (real low leaves exist)", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice)); // alice.handle = 5000
    sim.revoke(alice.handle);
    // IMT now: (0,5000)@0 and (5000,0)@1. Neither brackets 5000, so any attempt the holder
    // makes with a REAL in-tree leaf fails the on-chain bracketing assert.
    expect(() => sim.proveNotRevokedForged(alice, 0n, 5000n, 0n)).toThrow(); // 5000 < 5000 false
    expect(() => sim.proveNotRevokedForged(alice, 5000n, 0n, 1n)).toThrow(); // 5000 < 5000 false
  });

  it("the same handle cannot be revoked twice", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.revoke(alice.handle);
    expect(() => sim.revoke(alice.handle)).toThrow();
  });
});

describe("MIP-A: hardened two-step issuer rotation", () => {
  it("propose by current issuer, then accept by the new issuer (rights move)", () => {
    const sim = newSim();
    sim.proposeIssuerAs(issuer, bob);
    sim.acceptIssuerAs(bob);
    const newPk = pureCircuits.deriveIssuerPk({ bytes: bob.issuerSecret });
    expect(toHex(sim.issuerPk())).toBe(toHex(newPk.bytes));
    // old issuer lost authority; new issuer has it
    expect(() => sim.issueAs(issuer, sim.commitmentFor(alice))).toThrow();
    expect(() => sim.issueAs(bob, sim.commitmentFor(alice))).not.toThrow();
  });

  it("a non-issuer cannot propose a rotation", () => {
    const sim = newSim();
    expect(() => sim.proposeIssuerAs(carol, bob)).toThrow();
  });

  it("accept is rejected if the caller cannot prove the proposed secret", () => {
    const sim = newSim();
    sim.proposeIssuerAs(issuer, bob);
    expect(() => sim.acceptIssuerAs(carol)).toThrow(); // carol != proposed bob key
  });

  it("rotation does NOT invalidate already-issued credentials (namespace is stable)", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.proposeIssuerAs(issuer, bob);
    sim.acceptIssuerAs(bob);
    expect(() => sim.proveIssuedAs(alice)).not.toThrow();
  });
});

describe("MIP-A: privacy — secrets never reach the ledger", () => {
  // 31-byte (248-bit) big-endian hex of a handle, as it would appear if leaked verbatim
  function handleHex(h: bigint): string {
    return h.toString(16).padStart(62, "0");
  }

  it("an unrevoked holder's secret, nonce and handle never appear in ledger state", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.revoke(bob.handle); // populate the revoked set (publishes only a hash)

    const dump = (
      sim.circuitContext.currentQueryContext.state as unknown as {
        toString: () => string;
      }
    ).toString();

    expect(dump).not.toContain(toHex(alice.holderSecret));
    expect(dump).not.toContain(toHex(alice.nonce));
    expect(dump).not.toContain(handleHex(alice.handle));
  });
});
