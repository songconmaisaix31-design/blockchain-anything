// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Public sample used to exercise the BCA Foundry tools.
contract BCACounter is Ownable {
    uint256 public number;

    event NumberChanged(uint256 value);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setNumber(uint256 newNumber) public onlyOwner {
        number = newNumber;
        emit NumberChanged(newNumber);
    }

    function increment() public {
        number += 1;
    }
}
