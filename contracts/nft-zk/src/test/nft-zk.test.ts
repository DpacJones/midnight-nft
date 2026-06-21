// Claim-model NftZk tests (v1.1, per-token commitments). SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { NftZkSimulator, makeUser, toHex, strBytes64 } from "./nft-zk-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

setNetworkId("undeployed");

const admin = makeUser("Admin");
const alice = makeUser("Alice");
const bob = makeUser("Bob");
const carol = makeUser("Carol");

describe("NftZk claim-model", () => {
  it("admin mints into a pending claim; token is pending, not yet owned", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    expect(sim.tokenExists(1n)).toBe(true);
    expect(toHex(sim.pendingOf(1n))).toBe(toHex(sim.claimCommitment(bob)));
    expect(() => sim.ownerOf(1n)).toThrow();
  });

  it("recipient claims a minted token and becomes the owner", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    sim.claim(bob, 1n);
    // offline ownership query: recompute the per-token commitment and match on-chain state
    expect(toHex(sim.ownerOf(1n))).toBe(toHex(sim.ownerCommitment(bob, 1n)));
    expect(() => sim.pendingOf(1n)).toThrow();
  });

  it("wrong recipient (different pubkey) cannot claim", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    expect(() => sim.claim(carol, 1n)).toThrow();
  });

  it("right recipient but wrong salt cannot claim", () => {
    const sim = new NftZkSimulator(admin);
    const wrongSalt = new Uint8Array(32).fill(9);
    sim.mintAdmin(sim.claimCommitmentWithSalt(bob, wrongSalt), 1n);
    expect(() => sim.claim(bob, 1n)).toThrow();
  });

  it("owner releases and a new recipient claims (private transfer)", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.claim(alice, 1n);
    expect(toHex(sim.ownerOf(1n))).toBe(toHex(sim.ownerCommitment(alice, 1n)));
    sim.release(alice, 1n, sim.claimCommitment(bob));
    expect(() => sim.ownerOf(1n)).toThrow(); // pending again
    sim.claim(bob, 1n);
    expect(toHex(sim.ownerOf(1n))).toBe(toHex(sim.ownerCommitment(bob, 1n)));
  });

  it("non-owner cannot release", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.claim(alice, 1n);
    expect(() => sim.release(carol, 1n, sim.claimCommitment(bob))).toThrow();
  });

  it("a token cannot be claimed twice", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    sim.claim(bob, 1n);
    expect(() => sim.claim(bob, 1n)).toThrow();
  });

  it("owner can burn their own token; non-owner cannot", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.claim(alice, 1n);
    expect(() => sim.burn(carol, 1n)).toThrow();
    sim.burn(alice, 1n);
    expect(sim.tokenExists(1n)).toBe(false);
  });

  it("non-admin cannot mint", () => {
    const sim = new NftZkSimulator(admin);
    expect(() => sim.mintAdminAs(carol, sim.claimCommitment(bob), 1n)).toThrow();
  });

  it("duplicate tokenId mint is rejected", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    expect(() => sim.mintAdmin(sim.claimCommitment(alice), 1n)).toThrow();
  });
});

describe("NftZk unlinkability (H2 fix)", () => {
  it("the same owner's two tokens have DIFFERENT on-chain owner commitments", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.mintAdmin(sim.claimCommitment(alice), 2n);
    sim.claim(alice, 1n);
    sim.claim(alice, 2n);
    const o1 = toHex(sim.ownerOf(1n));
    const o2 = toHex(sim.ownerOf(2n));
    // Both are Alice's, but the on-chain commitments must NOT be equal (tokenId folded in).
    expect(o1).not.toBe(o2);
    // And each matches Alice's per-token offline recomputation.
    expect(o1).toBe(toHex(sim.ownerCommitment(alice, 1n)));
    expect(o2).toBe(toHex(sim.ownerCommitment(alice, 2n)));
  });
});

describe("NftZk metadata", () => {
  const uri = strBytes64("ipfs://QmTokenMetadataHashExample");

  it("mint stores the token URI; uriOf returns it", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 7n, uri);
    expect(toHex(sim.uriOf(7n))).toBe(toHex(uri));
  });

  it("token URI persists through a release -> claim transfer", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 7n, uri);
    sim.claim(alice, 7n);
    sim.release(alice, 7n, sim.claimCommitment(bob));
    sim.claim(bob, 7n);
    expect(toHex(sim.uriOf(7n))).toBe(toHex(uri));
  });

  it("burning a token removes its URI", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 7n, uri);
    sim.claim(alice, 7n);
    sim.burn(alice, 7n);
    expect(() => sim.uriOf(7n)).toThrow();
  });
});
