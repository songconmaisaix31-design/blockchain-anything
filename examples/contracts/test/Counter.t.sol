// SPDX-License-Identifier: MIT
pragma solidity ^0.7.0;

import "../src/Counter.sol";

contract CounterTest {
    function testIncrement() public {
        Counter counter = new Counter();
        counter.increment();
        require(counter.get() == 1, "counter did not increment");
    }
}
