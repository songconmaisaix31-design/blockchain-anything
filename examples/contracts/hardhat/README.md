# Hardhat sample

Public sample project for `hardhat_compile` and `hardhat_test`. It uses the
official Hardhat 3 CLI and viem toolbox, plus the official OpenZeppelin
Contracts package.

## Setup

Requires Node.js 22.13 or newer. From this directory:

```sh
npm install
npm run compile
npm test
```

`node_modules/`, `artifacts/` and `cache/` are ignored by git.

## BCA usage

`hardhat_compile` and `hardhat_test` resolve the project's own
`node_modules/hardhat` CLI. The BCA tools only run the fixed `compile` and
`test` tasks; they do not deploy or execute arbitrary scripts.

`scripts/check-development.ts` uses this directory by default.
