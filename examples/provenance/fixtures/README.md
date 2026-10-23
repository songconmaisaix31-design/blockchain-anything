# Provenance fixtures

These fixtures are real test inputs, not mocks.

## RISC Zero

- `risc0-v3-receipt.json`: constants copied from the official
  `risc0/risc0-ethereum` test contract `contracts/test/TestReceiptV3_0.sol`
  (Apache-2.0), retrieved 2026-10-23 from
  <https://github.com/risc0/risc0-ethereum/blob/main/contracts/test/TestReceiptV3_0.sol>.
- The journal is the UTF-8 string `just a simple receipt`.
- The proof was verified on Ethereum Sepolia against the official RISC Zero
  3.0.0 Groth16 verifier and router; see `docs/integrations/provenance.md`.

## in-toto

- `intoto-artifact.txt`: locally generated test artifact.
- `intoto-key.pub`: public half of a locally generated Ed25519 key. The private
  key was not committed and is no longer needed.
- `intoto-link.link`: real signed in-toto link metadata generated with the
  official `in-toto-record`/`in-toto-sign` CLI (in-toto 3.1.0). It records the
  SHA-256 of `intoto-artifact.txt` as both material and product.
- `intoto-statement.json`: locally generated in-toto Statement v1 for the same
  artifact, used to exercise the official `in-toto-attestation` protobuf
  validator.

## OpenTimestamps

The `.ots` fixture is not copied here. The checker uses the official example
shipped with the `opentimestamps@0.4.9` npm package:
`node_modules/opentimestamps/examples/hello-world.txt` and
`node_modules/opentimestamps/examples/hello-world.txt.ots`.

## cheqd

- `cheqd-did-document.json`: the `didDocument` returned by the official cheqd
  resolver for `did:cheqd:testnet:b003df6f-ec8e-48dd-9a2b-7011c5cf0a5e`,
  retrieved 2026-10-23. The DID document metadata version ID is
  `1838d661-447a-4cb6-8020-65a1b7849166`. It is a public DID document, not a
  private key or credential.
