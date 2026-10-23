// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BCACounter} from "../src/BCACounter.sol";

contract BCACounterTest is Test {
    BCACounter private counter;

    function setUp() public {
        counter = new BCACounter(address(this));
    }

    function test_Increment() public {
        counter.increment();
        assertEq(counter.number(), 1);
    }

    function test_SetNumber() public {
        counter.setNumber(42);
        assertEq(counter.number(), 42);
    }

    function test_RevertWhen_NotOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        counter.setNumber(7);
    }
}
