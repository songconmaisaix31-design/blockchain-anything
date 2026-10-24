import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createToolkit, asGameFunctions, asElizaPlugin } from '../src/index.js';
import { EdDSASigner } from 'did-jwt';
import { createVerifiableCredentialJwt } from 'did-jwt-vc';
import { base58btc } from 'multiformats/bases/base58';
import { Transaction } from '@mysten/sui/transactions';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import Arweave from 'arweave';

// One real offline SDK pass. No network substitutes, balances, mocks or model calls.
const toolkit = createToolkit();
const call = (name: string, input: unknown) => toolkit.invoke(name, input) as Promise<any>;
await mkdir('.work', { recursive: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'jwk' });
const secret = privateKey.export({ format: 'jwk' });
const did = `did:key:${base58btc.encode(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(pub.x!, 'base64url')]))}`;
const jwt = await createVerifiableCredentialJwt({ sub: did, nbf: Math.floor(Date.now() / 1000) - 5,
  vc: { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], credentialSubject: { id: did, project: 'BCA SDK check' } },
}, { did, alg: 'EdDSA', signer: EdDSASigner(Buffer.concat([Buffer.from(secret.d!, 'base64url'), Buffer.from(pub.x!, 'base64url')])) });
assert.equal((await call('vc_verify_jwt', { jwt })).verified, true);
const [header, payload, signature] = jwt.split('.');
const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), sub: 'did:key:changed' })).toString('base64url');
await assert.rejects(call('vc_verify_jwt', { jwt: `${header}.${tampered}.${signature}` }));
assert.equal((await call('did_key_resolve', { did })).didDocument.id, did);

const tx = new Transaction();
tx.setSender('0x1');
const serialized = tx.serialize();
assert.ok((await call('sui_transaction_inspect', { serialized })).sender);

const payment = { x402Version: 2, resource: { url: 'https://example.com/test', description: 'test', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: 'eip155:8453' as const, amount: '1', asset: '0x0000000000000000000000000000000000000001', payTo: '0x0000000000000000000000000000000000000002', maxTimeoutSeconds: 60 }] };
assert.equal((await call('x402_decode', { kind: 'required', header: encodePaymentRequiredHeader(payment) })).value.accepts[0].amount, '1');
assert.ok((await call('ccxt_exchanges', {})).exchanges.includes('binance'));

const arweave = Arweave.init({});
const key = await arweave.wallets.generate();
const arTx = await arweave.createTransaction({ data: 'BCA offline SDK check', last_tx: Buffer.alloc(32).toString('base64url'), reward: '0' }, key);
await arweave.transactions.sign(arTx, key);
await writeFile('.work/arweave-transaction.json', JSON.stringify(arTx));
assert.equal((await call('arweave_verify', { path: '.work/arweave-transaction.json' })).valid, true);

const game = (await asGameFunctions(toolkit)).find((fn) => fn.name === 'content_cid')!;
assert.equal((await game.executable({ input: JSON.stringify({ path: 'README.md' }) }, () => {})).status, 'done');
const eliza = asElizaPlugin(toolkit).actions.find((action) => action.name === 'CONTENT_CID')!;
assert.equal((await eliza.handler(null, null, null, { input: { path: 'README.md' } })).success, true);
console.log(JSON.stringify({ ok: true, tools: toolkit.tools.length, checked: ['VC-JWT signature and tamper rejection', 'did:key', 'Sui Transaction', 'x402 headers', 'CCXT', 'Arweave signature', 'GAME function', 'eliza handler'] }));
