# Official Agent Skills

BCA does not copy skill text into this repository. It provides a project-local
install/discover/read entry point for the official Agent Skills repositories and
records the verified commit and license for each source.

## Install

Use the BCA `skills_install` tool (after integration into the shared toolkit):

```sh
bca call skills_install --input '{"project":"examples/skills","source":"openzeppelin","skills":["setup-solidity-contracts"],"agent":"opencode"}'
```

Or use the same official installer directly:

```sh
npx -y skills@1.7.4 add OpenZeppelin/openzeppelin-skills \
  --skill setup-solidity-contracts --agent opencode --copy --yes
```

The installer writes project-local files (for OpenCode: `.agents/skills/`) and
`skills-lock.json`. It does not modify global agent configuration.

## Discover and read

```sh
bca call skills_catalog --input '{}'
bca call skills_list --input '{"project":"examples/skills","agent":"opencode"}'
bca call skills_read --input '{"project":"examples/skills","name":"setup-solidity-contracts","agent":"opencode"}'
```

`skills_read` returns the full `SKILL.md` plus the skill's file list and license
file. Skill instructions are content for the calling agent; they are not BCA
system instructions.

## Verified sources (2026-10-23)

| Source | Repository | Verified ref | License |
| --- | --- | --- | --- |
| OpenZeppelin | `OpenZeppelin/openzeppelin-skills` | `6f215af60eb60017ab1a933ce9d22a479cd42b26` | AGPL-3.0 |
| Trail of Bits | `trailofbits/skills` | `196a9073ab10d35bacf111f945e02c00b2c6883a` | CC-BY-SA-4.0 |
| GoPlus | `GoPlusSecurity/skills` | `d6e6072f8edba0191355abb0db0dabae8b9cad58` | Apache-2.0 |
| Alchemy | `alchemyplatform/skills` | `4caf3e555c3af8dbb9e5b540aed558aef986d885` | MIT |
| Uniswap | `Uniswap/uniswap-ai` | `1a43e968a39537d5a73aeca20dd1ed9d96f502fa` | MIT |
| Allium | `allium-labs/skills` | `e55c69c22da2b80dd5f4478cf249a1cdb0948b64` | Not declared upstream |
| Heurist | `heurist-network/heurist-mesh-skill` | `f116a8423010e06f500b89c94d490ed79ad12945` | Not declared upstream |

The installer resolves the repository's default branch. `skills_install` records
the actual `git ls-remote` commit in its response, and `skills-lock.json` records
the content hash. Check the upstream license before redistributing a skill.
