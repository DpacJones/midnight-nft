// Claim-model NftZk tests. SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { NftZkSimulator, makeUser, toHex } from "./nft-zk-simulator.js";
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
    expect(() => sim.ownerOf(1n)).toThrow(); // not owned until claimed
    expect(sim.balanceOf(bob)).toBe(0n);
  });

  it("recipient claims a minted token and becomes the owner", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    sim.claim(bob, 1n);
    expect(toHex(sim.ownerOf(1n))).toBe(toHex(sim.ownerCommitment(bob)));
    expect(sim.balanceOf(bob)).toBe(1n);
    expect(() => sim.pendingOf(1n)).toThrow(); // no longer pending
  });

  it("wrong recipient (different pubkey) cannot claim", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(bob), 1n);
    expect(() => sim.claim(carol, 1n)).toThrow();
  });

  it("right recipient but wrong salt cannot claim", () => {
    const sim = new NftZkSimulator(admin);
    // mint to a commitment built with Bob's pubkey but a salt Bob does NOT hold
    const wrongSalt = new Uint8Array(32).fill(9);
    sim.mintAdmin(sim.claimCommitmentWithSalt(bob, wrongSalt), 1n);
    expect(() => sim.claim(bob, 1n)).toThrow(); // Bob's real salt != minted salt
  });

  it("owner releases and a new recipient claims (private transfer)", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.claim(alice, 1n);
    expect(sim.balanceOf(alice)).toBe(1n);
    sim.release(alice, 1n, sim.claimCommitment(bob));
    expect(sim.balanceOf(alice)).toBe(0n);
    expect(() => sim.ownerOf(1n)).toThrow(); // pending again
    sim.claim(bob, 1n);
    expect(toHex(sim.ownerOf(1n))).toBe(toHex(sim.ownerCommitment(bob)));
    expect(sim.balanceOf(bob)).toBe(1n);
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
    expect(() => sim.claim(bob, 1n)).toThrow(); // no pending claim anymore
  });

  it("owner can burn their own token; non-owner cannot", () => {
    const sim = new NftZkSimulator(admin);
    sim.mintAdmin(sim.claimCommitment(alice), 1n);
    sim.claim(alice, 1n);
    expect(() => sim.burn(carol, 1n)).toThrow();
    sim.burn(alice, 1n);
    expect(sim.tokenExists(1n)).toBe(false);
    expect(sim.balanceOf(alice)).toBe(0n);
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
