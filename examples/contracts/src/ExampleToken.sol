// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Demonstrates reuse of the installed OpenZeppelin implementation.
contract ExampleToken is ERC20 {
    constructor() ERC20("Example Token", "EXAMPLE") {}
}
