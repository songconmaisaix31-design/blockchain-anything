import { createRequire } from 'node:module';
import { JsonRpcProvider, Transaction as EthersTransaction, Wallet, ZeroAddress, ZeroHash, getAddress } from 'ethers';
import type { TransactionReceipt } from 'ethers';
import type { EAS as EasInstance, SchemaRegistry as RegistryInstance, Transaction, SchemaItem, SignedOffchainAttestation } from '@ethereum-attestation-service/eas-sdk';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireWrites } from '../config.js';
import { defineTool } from '../types.js';
import { addressSchema, bytesSchema, submitSchema, uidSchema, uint64Schema, uint256Schema, TransactionFailure } from './common.js';
import { withProvider } from './evm.js';

// 使用该版本官方提供的 CommonJS 入口，Node ESM 通过 createRequire 加载。
const { EAS, SchemaRegistry, SchemaEncoder } = createRequire(import.meta.url)('@ethereum-attestation-service/eas-sdk') as typeof import('@ethereum-attestation-service/eas-sdk');

interface EasContext {
  provider: JsonRpcProvider;
  eas: EasInstance;
  registry: RegistryInstance;
  version: string;
  registryVersion: string;
}

async function withEas<T>(config: Config, operation: (context: EasContext) => Promise<T>): Promise<T> {
  if (!config.easAddress || !config.registryAddress) throw new Error('需要 BCA_EAS_ADDRESS 和 BCA_SCHEMA_REGISTRY_ADDRESS');
  const easAddress = config.easAddress;
  const registryAddress = config.registryAddress;
  return withProvider(config, async (provider) => {
    if (await provider.getCode(easAddress) === '0x') throw new Error('BCA_EAS_ADDRESS 没有合约代码');
    if (await provider.getCode(registryAddress) === '0x') throw new Error('BCA_SCHEMA_REGISTRY_ADDRESS 没有合约代码');
    const eas = new EAS(easAddress).connect(provider);
    const registry = new SchemaRegistry(registryAddress).connect(provider);
    if (getAddress(await eas.contract.getSchemaRegistry()) !== registryAddress) throw new Error('EAS 的 SchemaRegistry 与配置不匹配');
    const version = await eas.getVersion();
    const registryVersion = await registry.getVersion();
    return operation({ provider, eas, registry, version, registryVersion });
  });
}

async function submitTransaction<T>(config: Config, provider: JsonRpcProvider, wallet: Wallet, transaction: Transaction<unknown>, result: (receipt: TransactionReceipt) => T) {
  const populated = await wallet.populateTransaction(transaction.data);
  const signed = await wallet.signTransaction(populated);
  const transactionHash = EthersTransaction.from(signed).hash;
  if (!transactionHash) throw new Error('无法取得已签署交易的哈希');
  try {
    // SDK 构造交易，ethers 提交和限时等待；此路径仅广播一次。
    const response = await provider.broadcastTransaction(signed);
    const receipt = await response.wait(1, config.timeoutMs);
    if (!receipt || receipt.status !== 1) throw new Error('交易未取得成功回执');
    return { ...result(receipt), transactionHash, receipt: receipt.toJSON(), chainId: config.chainId };
  } catch (error) {
    throw new TransactionFailure(error instanceof Error ? error.message : '交易提交或确认失败', transactionHash);
  }
}

const attestationFields = {
  schema: uidSchema,
  recipient: addressSchema.default(ZeroAddress),
  expirationTime: uint64Schema.default('0'),
  revocable: z.boolean(),
  refUID: uidSchema.default(ZeroHash),
  data: bytesSchema,
};

const messageSchema = z.strictObject({
  version: z.literal(2), schema: uidSchema, recipient: addressSchema, time: uint64Schema,
  expirationTime: uint64Schema, revocable: z.boolean(), refUID: uidSchema, data: bytesSchema, salt: uidSchema,
});

const signedSchema = z.strictObject({
  version: z.literal(2), uid: uidSchema,
  domain: z.strictObject({ name: z.string(), version: z.string(), chainId: uint256Schema, verifyingContract: addressSchema }),
  primaryType: z.string(),
  types: z.record(z.string(), z.array(z.strictObject({ name: z.string(), type: z.enum(['bool', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256', 'address', 'string', 'bytes', 'bytes32']) }))),
  message: messageSchema,
  signature: z.strictObject({ r: uidSchema, s: uidSchema, v: z.union([z.literal(27), z.literal(28)]) }),
});

export function easTools(config: Config) {
  return [
    defineTool('eas_schema_encode', '使用 EAS SchemaEncoder 编码 ABI 数据；大整数请使用十进制字符串。',
      z.strictObject({ schema: z.string().min(1), fields: z.array(z.strictObject({ name: z.string(), type: z.string().min(1), value: z.union([z.string(), z.boolean(), z.number().int().safe(), z.array(z.json()), z.record(z.string(), z.json())]) })) }), true,
      async ({ schema, fields }) => ({ data: new SchemaEncoder(schema).encodeData(fields as SchemaItem[]) })),
    defineTool('eas_schema_decode', '使用 EAS SchemaEncoder 解码 ABI 数据，保留官方字段结构。',
      z.strictObject({ schema: z.string().min(1), data: bytesSchema }), true,
      async ({ schema, data }) => ({ fields: new SchemaEncoder(schema).decodeData(data) })),
    defineTool('eas_status', '核对实际 chain ID、EAS/Registry 合约代码、关联地址和合约版本。', z.strictObject({}), true,
      async () => withEas(config, async ({ version, registryVersion }) => ({ chainId: config.chainId, easAddress: config.easAddress, registryAddress: config.registryAddress, version, registryVersion, connectionVerified: true, contractCodeVerified: true, registryAssociationVerified: true }))),
    defineTool('eas_schema_get', '从已核验的 SchemaRegistry 查询原生 Schema UID。', z.strictObject({ uid: uidSchema }), true,
      async ({ uid }) => withEas(config, async ({ registry }) => {
        const schema = await registry.getSchema({ uid });
        return { found: schema.uid !== ZeroHash, schema, chainId: config.chainId };
      })),
    defineTool('eas_schema_register', '向配置的 EAS SchemaRegistry 注册公开 Schema；交易需要支付网络费用。',
      z.strictObject({ schema: z.string().min(1), resolverAddress: addressSchema.default(ZeroAddress), revocable: z.boolean(), submit: submitSchema }), false,
      async ({ schema, resolverAddress, revocable }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, registry }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          registry.connect(wallet);
          const transaction = await registry.register({ schema, resolverAddress, revocable });
          return submitTransaction(config, provider, wallet, transaction, () => ({ uid: SchemaRegistry.getSchemaUID(schema, resolverAddress, revocable) }));
        });
      }),
    defineTool('eas_attest', '发布公开 EAS 声明；data、recipient、refUID 等字段将上链，valueWei 与网络费用由签署账户支付。',
      z.strictObject({ ...attestationFields, valueWei: uint256Schema.default('0'), submit: submitSchema }), false,
      async ({ schema, recipient, expirationTime, revocable, refUID, data, valueWei }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.attest({ schema, data: { recipient, expirationTime: BigInt(expirationTime), revocable, refUID, data, value: BigInt(valueWei) } });
          return submitTransaction(config, provider, wallet, transaction, (receipt) => {
            // ethers 的 ESM/CJS 类型各有私有成员，SDK 在此只读取公开 receipt 字段。
            const uids = eas.getUIDsFromAttestReceipt(receipt as unknown as Parameters<EasInstance['getUIDsFromAttestReceipt']>[0]);
            if (!uids[0]) throw new Error('EAS 回执没有声明 UID');
            return { uid: uids[0] };
          });
        });
      }),
    defineTool('eas_get', '查询 EAS 链上声明原始字段，包括 expirationTime 和 revocationTime。', z.strictObject({ uid: uidSchema }), true,
      async ({ uid }) => withEas(config, async ({ eas }) => {
        const attestation = await eas.getAttestation(uid);
        return { found: attestation.uid !== ZeroHash, attestation, chainId: config.chainId };
      })),
    defineTool('eas_revoke', '由签署账户执行 EAS 链上撤销，撤销状态公开且需要网络费用。',
      z.strictObject({ schema: uidSchema, uid: uidSchema, valueWei: uint256Schema.default('0'), submit: submitSchema }), false,
      async ({ schema, uid, valueWei }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.revoke({ schema, data: { uid, value: BigInt(valueWei) } });
          return submitTransaction(config, provider, wallet, transaction, () => ({ uid }));
        });
      }),
    defineTool('eas_offchain_sign', '使用本地开发签署器生成 EAS v2 链下签名；domain 取自核验后的 chain/address/合约版本，不提交链上声明。',
      z.strictObject({ ...attestationFields, time: uint64Schema, submit: submitSchema }), false,
      async ({ schema, recipient, time, expirationTime, revocable, refUID, data }) => {
        requireWrites(config);
        return withEas(config, async ({ eas, provider }) => {
          const signer = new Wallet(config.privateKey!, provider);
          const offchain = await eas.getOffchain();
          const attestation = await offchain.signOffchainAttestation({ schema, recipient, time: BigInt(time), expirationTime: BigInt(expirationTime), revocable, refUID, data }, signer);
          return { signer: signer.address, attestation, onchainSubmitted: false };
        });
      }),
    defineTool('eas_offchain_verify', '核对预期网络和 EAS domain/版本/签署者，并使用 SDK 验证 v2 UID 与签名；未检查撤销、时间戳、有效期和信任。',
      z.strictObject({ expectedSigner: addressSchema, attestation: signedSchema }), true,
      async ({ expectedSigner, attestation }) => withEas(config, async ({ eas }) => {
        const offchain = await eas.getOffchain();
        const expected = offchain.getDomainTypedData();
        const domain = attestation.domain;
        if (domain.name !== expected.name || domain.version !== expected.version || BigInt(domain.chainId) !== expected.chainId || getAddress(domain.verifyingContract) !== getAddress(expected.verifyingContract)) {
          throw new Error('链下签名 domain 与配置的 chain/address/合约版本不匹配');
        }
        const signed: SignedOffchainAttestation = { ...attestation, domain: { ...domain, verifyingContract: expected.verifyingContract, chainId: BigInt(domain.chainId) }, message: { ...attestation.message, time: BigInt(attestation.message.time), expirationTime: BigInt(attestation.message.expirationTime) } };
        const signatureValid = offchain.verifyOffchainAttestationSignature(getAddress(expectedSigner), signed);
        return { signatureValid, domainChecked: true, expectedSigner: getAddress(expectedSigner), expectedDomain: expected, offchainVersion: 2, revocationChecked: false, timestampChecked: false, expirationChecked: false, trustChecked: false };
      })),
  ];
}
