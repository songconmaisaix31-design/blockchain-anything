// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice 最小的离线编译示例；由 BCA 的 dev_solidity_compile 直接编译。
contract Counter {
    uint256 private value;

    function increment() external {
        value += 1;
    }

    function get() external view returns (uint256) {
        return value;
    }
}
