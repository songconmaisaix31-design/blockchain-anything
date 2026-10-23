# Foundry sample

Public sample project for `foundry_build`, `foundry_inspect`, `foundry_test` and
`foundry_call`. It uses the official OpenZeppelin Contracts package and Foundry's
official forge-std test library.

## Setup

Requires Forge 1.7 or newer. From this directory:

```sh
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

`lib/` is ignored by git; the two `forge install` commands fetch the official
libraries at their upstream refs.

## BCA usage

From the repository root:

```sh
BCA_DEVELOPMENT_ROOTS="$PWD" npx tsx -e "..." # or use the shared CLI after integration
```

The `scripts/check-development.ts` check uses this directory by default.
No deployment is performed by the BCA tools.
