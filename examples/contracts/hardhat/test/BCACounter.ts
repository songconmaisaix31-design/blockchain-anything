import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

describe("BCACounter", async function () {
  const { viem } = await network.create();

  it("increments and reads the public number", async function () {
    const [owner] = await viem.getWalletClients();
    const counter = await viem.deployContract("BCACounter", [owner.account.address]);

    await counter.write.increment();

    assert.equal(await counter.read.number(), 1n);
  });

  it("allows the owner to set a number", async function () {
    const [owner] = await viem.getWalletClients();
    const counter = await viem.deployContract("BCACounter", [owner.account.address]);

    await counter.write.setNumber([42n]);

    assert.equal(await counter.read.number(), 42n);
  });
});
