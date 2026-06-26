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
// Verifier-chosen, audience-bound challenge that seeds the presentation nullifier (JOB 3 rename
// from "sessionNonce"). Reusing the same challenge for the same credential yields the same
// nullifier (in-session reuse detection); a fresh challenge yields an unlinkable nullifier.
const CHALLENGE = strBytes("verifier-challenge-default");

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
  it("issuer issues a holder-built commitment; holder presents successfully", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
  });

  it("a holder who was never issued cannot present", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.provePresentationAs(bob, CHALLENGE)).toThrow();
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
    expect(() => sim.provePresentationAs(aliceCredA, CHALLENGE)).not.toThrow();
    expect(() => sim.provePresentationAs(aliceCredB, CHALLENGE)).not.toThrow();
  });
});

describe("MIP-A: issuer-only enforcement", () => {
  it("a non-issuer cannot issue", () => {
    const sim = newSim();
    expect(() => sim.issueAs(carol, sim.commitmentFor(alice))).toThrow();
  });

  it("a non-issuer cannot revoke", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
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
  it("a never-revoked holder presents (empty revoked set)", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
  });

  it("after revoking the handle, presentation fails", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
    sim.revoke(alice.handle);
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).toThrow();
  });

  it("revoking one holder does not affect another holder's presentation", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.issue(sim.commitmentFor(bob));
    sim.revoke(alice.handle);
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).toThrow();
    expect(() => sim.provePresentationAs(bob, CHALLENGE)).not.toThrow();
  });

  it("handles many revocations in mixed order and keeps the IMT consistent", () => {
    const sim = newSim();
    [alice, bob, carol, dave].forEach((u) => sim.issue(sim.commitmentFor(u)));
    // revoke carol(3000) then bob(9000) then dave(7000) — exercises both ends and the middle
    sim.revoke(carol.handle);
    sim.revoke(bob.handle);
    sim.revoke(dave.handle);
    expect(() => sim.provePresentationAs(carol, CHALLENGE)).toThrow();
    expect(() => sim.provePresentationAs(bob, CHALLENGE)).toThrow();
    expect(() => sim.provePresentationAs(dave, CHALLENGE)).toThrow();
    // alice (5000) was never revoked and sits between carol and dave -> still valid
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
    // sentinel + 3 revocations (each adds one leaf) = 4 (count starts at 1 for sentinel)
    expect(sim.revokedCount()).toBe(4n);
  });

  it("the CIRCUIT rejects a forged bracket for a revoked handle (real low leaves exist)", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice)); // alice.handle = 5000
    sim.revoke(alice.handle);
    // IMT now: (0,5000)@0 and (5000,0)@1. Neither brackets 5000, so any attempt the holder
    // makes with a REAL in-tree leaf fails the on-chain bracketing assert.
    expect(() =>
      sim.provePresentationForged(alice, CHALLENGE, 0n, 5000n, 0n),
    ).toThrow(); // handle 5000 < low.next 5000 is false
    expect(() =>
      sim.provePresentationForged(alice, CHALLENGE, 5000n, 0n, 1n),
    ).toThrow(); // low.value 5000 < handle 5000 is false
  });

  it("the same handle cannot be revoked twice", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.revoke(alice.handle);
    expect(() => sim.revoke(alice.handle)).toThrow();
  });
});

describe("MIP-A: H1 — single bound presentation (no mix-and-match)", () => {
  it("a revoked holder cannot present even though their commitment is still issued", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
    sim.revoke(alice.handle);
    // alice's commitment is STILL an issued leaf, but membership and non-revocation are now
    // proven over the SAME opening in ONE circuit, so the old "prove issued with the real
    // handle, prove not-revoked with a fake handle" bypass is structurally impossible. Even a
    // forged bracket over the real revoked handle fails the on-chain non-membership asserts.
    expect(() =>
      sim.provePresentationForged(alice, CHALLENGE, 0n, alice.handle, 0n),
    ).toThrow();
    expect(() =>
      sim.provePresentationForged(alice, CHALLENGE, alice.handle, 0n, 1n),
    ).toThrow();
  });

  it("the session nullifier is stable within a session and unlinkable across sessions", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    const n1 = sim.provePresentationAs(alice, strBytes("session-1"));
    const n1b = sim.provePresentationAs(alice, strBytes("session-1"));
    const n2 = sim.provePresentationAs(alice, strBytes("session-2"));
    expect(toHex(n1)).toBe(toHex(n1b));
    expect(toHex(n1)).not.toBe(toHex(n2));
  });
});

describe("MIP-A: H2 — revoke index bound to the proven predecessor path", () => {
  it("a revoke with correct predecessor coordinates but a WRONG index reverts", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    sim.issue(sim.commitmentFor(bob));
    sim.revoke(bob.handle); // IMT: (0,9000)@0, (9000,0)@1
    // alice(5000)'s real predecessor is (0,9000)@0; pointing at index 1 (a different leaf)
    // makes getRevokeLowPath return a path whose leaf != revLeafHash(0,9000) -> revert.
    expect(() =>
      sim.revokeForged(issuer, alice.handle, 0n, 9000n, 1n),
    ).toThrow();
    // the correctly-indexed revoke still succeeds, and alice can then no longer present
    sim.revoke(alice.handle);
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).toThrow();
  });

  it("a revoke whose predecessor sits at index >= 2 succeeds (locks indexFromPath bit convention)", () => {
    const sim = newSim();
    // Build an ASCENDING chain so each new predecessor lands at a progressively higher index.
    // revoke only needs issuer auth + correct bracketing (no issuance required).
    sim.revoke(1000n); // predecessor (0,0)@0      -> IMT: (0,1000)@0, (1000,0)@1
    sim.revoke(2000n); // predecessor (1000,0)@1   -> IMT: (0,1000)@0,(1000,2000)@1,(2000,0)@2
    sim.revoke(3000n); // predecessor (2000,0)@2   -> IMT: ...,(2000,3000)@2,(3000,0)@3
    // Predecessor of 2500 is (2000,3000) at INDEX 2 -> indexFromPath must yield 2 (bit 1 set).
    // If indexFromPath mis-folded the high bits, the in-place splice would overwrite the wrong
    // leaf and the off-chain mirror would diverge, surfacing as a failure on the NEXT revoke.
    expect(() => sim.revoke(2500n)).not.toThrow();
    // Now (2500,3000) lives at INDEX 4; predecessor of 2700 is (2500,3000)@4 -> indexFromPath
    // must yield 4 (bit 2 set). A correct revoke here only succeeds if both bit-1 and bit-2
    // were folded correctly across the chain.
    expect(() => sim.revoke(2700n)).not.toThrow();
    // And a forged WRONG index for that same high-index predecessor still reverts (the path
    // fetched for index 2 has leaf != revLeafHash(2500,3000)).
    expect(() =>
      sim.revokeForged(issuer, 2800n, 2700n, 3000n, 2n),
    ).toThrow();
    // sentinel(1) + 5 successful revokes (1000,2000,3000,2500,2700); the forged one reverted.
    expect(sim.revokedCount()).toBe(6n);
  });
});

describe("MIP-A: handle 0 (IMT sentinel) is forbidden", () => {
  it("revoke(handle=0) is rejected in-circuit", () => {
    const sim = newSim();
    // assert(handle != 0) fires before any bracketing logic
    expect(() => sim.revokeForged(issuer, 0n, 0n, 0n, 0n)).toThrow();
  });

  it("a credential carrying handle 0 cannot present", () => {
    const sim = newSim();
    const zeroUser = makeUser("Zero", 0n);
    sim.issue(sim.commitmentFor(zeroUser));
    // even with the sentinel as the (forged) bracket, assert(handle != 0) rejects it
    expect(() =>
      sim.provePresentationForged(zeroUser, CHALLENGE, 0n, 0n, 0n),
    ).toThrow();
  });
});

describe("MIP-A: wallet-profile teeth (proof of holder identity)", () => {
  it("a wallet-profile holder presents with the correct identity secret", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice)); // alice uses the wallet profile by default
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
  });

  it("a wallet-profile presentation with a WRONG identity secret is rejected", () => {
    const sim = newSim();
    sim.issue(sim.commitmentFor(alice));
    expect(() =>
      sim.provePresentationAs(alice, CHALLENGE, {
        holder_identity_secret: strBytes("not-alices-identity"),
      }),
    ).toThrow();
  });

  it("a bearer-profile holder presents WITHOUT any identity secret", () => {
    const sim = newSim();
    const carolBearer = makeUser(
      "CarolBearer",
      4200n,
      pureCircuits.bearerProfileTag(),
    );
    sim.issue(sim.commitmentFor(carolBearer));
    // a zeroed identity secret is fine: the bearer profile skips the identity check
    expect(() =>
      sim.provePresentationAs(carolBearer, CHALLENGE, {
        holder_identity_secret: new Uint8Array(32),
      }),
    ).not.toThrow();
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
    expect(() => sim.provePresentationAs(alice, CHALLENGE)).not.toThrow();
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

describe("MIP-A: deploymentSalt — per-deployment namespace separation", () => {
  // Regression guard for the kernel.self() footgun. kernel.self() is unusable in a constructor
  // (it resolves to the dummy/zero contract address because the address does not yet exist when
  // the constructor circuit runs), so two deployments sharing (issuer, schemaId) would otherwise
  // derive IDENTICAL namespaces — enabling cross-instance commitment replay. The contract now
  // folds an explicit caller-supplied deploymentSalt into the sealed namespace instead.
  it("distinct deploymentSalts -> distinct issuerNamespace for identical issuer+domain+schema", () => {
    const saltA = strBytes("deployment-A");
    const saltB = strBytes("deployment-B");
    const simA = new CredentialZkSimulator(issuer, DOMAIN, SCHEMA, saltA);
    const simB = new CredentialZkSimulator(issuer, DOMAIN, SCHEMA, saltB);
    expect(toHex(simA.getLedger().issuerNamespace)).not.toBe(
      toHex(simB.getLedger().issuerNamespace),
    );
  });

  it("the SAME deploymentSalt is deterministic (same issuer+domain+schema -> same namespace)", () => {
    const salt = strBytes("deployment-shared");
    const simA = new CredentialZkSimulator(issuer, DOMAIN, SCHEMA, salt);
    const simB = new CredentialZkSimulator(issuer, DOMAIN, SCHEMA, salt);
    expect(toHex(simA.getLedger().issuerNamespace)).toBe(
      toHex(simB.getLedger().issuerNamespace),
    );
  });
});
