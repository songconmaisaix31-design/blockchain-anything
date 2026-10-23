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
const { EAS, SchemaRegistry, SchemaEncoder, PrivateData } = createRequire(import.meta.url)('@ethereum-attestation-service/eas-sdk') as typeof import('@ethereum-attestation-service/eas-sdk');

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
        const record = await registry.getSchema({ uid });
        const schema = { uid: record.uid, resolver: record.resolver, revocable: record.revocable, schema: record.schema };
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
        const record = await eas.getAttestation(uid);
        const attestation = {
          uid: record.uid, schema: record.schema, refUID: record.refUID,
          time: record.time, expirationTime: record.expirationTime, revocationTime: record.revocationTime,
          recipient: record.recipient, revocable: record.revocable, attester: record.attester, data: record.data,
        };
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

    defineTool('eas_multi_attest', '在一次交易中向一个或多个 Schema 发布多条公开 EAS 声明；返回回执中的全部原生 UID。',
      z.strictObject({
        requests: z.array(z.strictObject({
          schema: uidSchema,
          attestations: z.array(z.strictObject({
            recipient: addressSchema.default(ZeroAddress),
            expirationTime: uint64Schema.default('0'),
            revocable: z.boolean(),
            refUID: uidSchema.default(ZeroHash),
            data: bytesSchema,
            valueWei: uint256Schema.default('0'),
          })).min(1),
        })).min(1).max(50),
        submit: submitSchema,
      }), false,
      async ({ requests }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.multiAttest(requests.map((request) => ({
            schema: request.schema,
            data: request.attestations.map((item) => ({
              recipient: item.recipient,
              expirationTime: BigInt(item.expirationTime),
              revocable: item.revocable,
              refUID: item.refUID,
              data: item.data,
              value: BigInt(item.valueWei),
            })),
          })));
          return submitTransaction(config, provider, wallet, transaction, (receipt) => ({
            uids: eas.getUIDsFromAttestReceipt(receipt as unknown as Parameters<EasInstance['getUIDsFromAttestReceipt']>[0]),
          }));
        });
      }),

    defineTool('eas_multi_revoke', '在一次交易中批量撤销一个或多个 Schema 下的 EAS 声明。',
      z.strictObject({
        requests: z.array(z.strictObject({
          schema: uidSchema,
          revocations: z.array(z.strictObject({ uid: uidSchema, valueWei: uint256Schema.default('0') })).min(1),
        })).min(1).max(50),
        submit: submitSchema,
      }), false,
      async ({ requests }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.multiRevoke(requests.map((request) => ({
            schema: request.schema,
            data: request.revocations.map((item) => ({ uid: item.uid, value: BigInt(item.valueWei) })),
          })));
          return submitTransaction(config, provider, wallet, transaction, () => ({
            revoked: requests.reduce((total, request) => total + request.revocations.length, 0),
          }));
        });
      }),

    defineTool('eas_timestamp', '调用 EAS 官方合约对数据哈希做链上时间戳，返回回执中的时间戳。',
      z.strictObject({ data: bytesSchema.describe('通常是 bytes32 数据哈希'), submit: submitSchema }), false,
      async ({ data }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.timestamp(data);
          return submitTransaction(config, provider, wallet, transaction, (receipt) => ({
            timestamp: eas.getTimestampFromTimestampReceipt(receipt as unknown as Parameters<EasInstance['getTimestampFromTimestampReceipt']>[0])[0]?.toString() ?? null,
          }));
        });
      }),

    defineTool('eas_delegated_sign', '使用本地开发签署器生成 EAS 官方 Delegated EIP-712 签名；不广播交易。',
      z.strictObject({
        schema: uidSchema,
        recipient: addressSchema.default(ZeroAddress),
        expirationTime: uint64Schema.default('0'),
        revocable: z.boolean(),
        refUID: uidSchema.default(ZeroHash),
        data: bytesSchema,
        valueWei: uint256Schema.default('0'),
        deadline: uint64Schema.default('0'),
        submit: submitSchema,
      }), false,
      async ({ schema, recipient, expirationTime, revocable, refUID, data, valueWei, deadline }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const signer = new Wallet(config.privateKey!, provider);
          const delegated = await eas.getDelegated();
          const response = await delegated.signDelegatedAttestation({
            schema,
            recipient,
            expirationTime: BigInt(expirationTime),
            revocable,
            refUID,
            data,
            value: BigInt(valueWei),
            deadline: BigInt(deadline),
          }, signer);
          return { attester: signer.address, response, onchainSubmitted: false };
        });
      }),

    defineTool('eas_delegated_attest', '由中继账户提交预先签好的 EAS Delegated 声明；签名者与付费账户可以不同。',
      z.strictObject({
        schema: uidSchema,
        recipient: addressSchema.default(ZeroAddress),
        expirationTime: uint64Schema.default('0'),
        revocable: z.boolean(),
        refUID: uidSchema.default(ZeroHash),
        data: bytesSchema,
        valueWei: uint256Schema.default('0'),
        attester: addressSchema,
        deadline: uint64Schema.default('0'),
        signature: z.strictObject({ r: uidSchema, s: uidSchema, v: z.union([z.literal(27), z.literal(28)]) }),
        submit: submitSchema,
      }), false,
      async ({ schema, recipient, expirationTime, revocable, refUID, data, valueWei, attester, deadline, signature }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.attestByDelegation({
            schema,
            data: { recipient, expirationTime: BigInt(expirationTime), revocable, refUID, data, value: BigInt(valueWei) },
            signature,
            attester,
            deadline: BigInt(deadline),
          });
          return submitTransaction(config, provider, wallet, transaction, (receipt) => ({
            uid: eas.getUIDsFromAttestReceipt(receipt as unknown as Parameters<EasInstance['getUIDsFromAttestReceipt']>[0])[0],
          }));
        });
      }),

    defineTool('eas_delegated_sign_revoke', '使用本地开发签署器生成 EAS 官方 Delegated 撤销签名；不广播交易。',
      z.strictObject({
        schema: uidSchema,
        uid: uidSchema,
        valueWei: uint256Schema.default('0'),
        deadline: uint64Schema.default('0'),
        submit: submitSchema,
      }), false,
      async ({ schema, uid, valueWei, deadline }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const signer = new Wallet(config.privateKey!, provider);
          const delegated = await eas.getDelegated();
          const response = await delegated.signDelegatedRevocation({ schema, uid, value: BigInt(valueWei), deadline: BigInt(deadline) }, signer);
          return { revoker: signer.address, response, onchainSubmitted: false };
        });
      }),

    defineTool('eas_delegated_revoke', '由中继账户提交预先签好的 EAS Delegated 撤销。',
      z.strictObject({
        schema: uidSchema,
        uid: uidSchema,
        valueWei: uint256Schema.default('0'),
        revoker: addressSchema,
        deadline: uint64Schema.default('0'),
        signature: z.strictObject({ r: uidSchema, s: uidSchema, v: z.union([z.literal(27), z.literal(28)]) }),
        submit: submitSchema,
      }), false,
      async ({ schema, uid, valueWei, revoker, deadline, signature }) => {
        requireWrites(config);
        return withEas(config, async ({ provider, eas }) => {
          const wallet = new Wallet(config.privateKey!, provider);
          eas.connect(wallet);
          const transaction = await eas.revokeByDelegation({
            schema,
            data: { uid, value: BigInt(valueWei) },
            signature,
            revoker,
            deadline: BigInt(deadline),
          });
          return submitTransaction(config, provider, wallet, transaction, () => ({ uid }));
        });
      }),

    defineTool('eas_private_data_build', '使用 EAS 官方 PrivateData 构造 Merkle 树并返回根；可选生成多值披露证明。',
      z.strictObject({
        values: z.array(z.strictObject({
          type: z.string().min(1).describe('ABI 类型，例如 string、uint256、bytes32'),
          name: z.string().min(1),
          value: z.json(),
          salt: uidSchema.optional(),
        })).min(1),
        indexes: z.array(z.number().int().nonnegative()).optional().describe('要生成披露证明的值下标'),
      }), true,
      async ({ values, indexes }) => {
        const withSalt = values.filter((item) => item.salt !== undefined);
        if (withSalt.length > 0 && withSalt.length !== values.length) throw new Error('salt 必须全部提供或全部省略');
        const privateData = new PrivateData(values as unknown as ConstructorParameters<typeof PrivateData>[0]);
        const tree = privateData.getFullTree();
        return {
          root: tree.root,
          tree,
          proof: indexes ? privateData.generateMultiProof(indexes) : null,
        };
      }),

    defineTool('eas_private_data_verify', '使用 EAS 官方 PrivateData 验证 Merkle 多值披露证明。',
      z.strictObject({
        root: uidSchema,
        proof: z.strictObject({
          leaves: z.array(z.strictObject({ type: z.string(), name: z.string(), value: z.json(), salt: uidSchema })),
          proof: z.array(uidSchema),
          proofFlags: z.array(z.boolean()),
        }),
      }), true,
      async ({ root, proof }) => ({
        valid: PrivateData.verifyMultiProof(root, proof as unknown as Parameters<typeof PrivateData.verifyMultiProof>[1]),
      })),

    defineTool('eas_private_data_verify_tree', '使用 EAS 官方 PrivateData 从完整树重算根，并与给定根比较。',
      z.strictObject({
        tree: z.strictObject({
          root: uidSchema,
          values: z.array(z.strictObject({ type: z.string(), name: z.string(), value: z.json(), salt: uidSchema })),
        }),
      }), true,
      async ({ tree }) => {
        const computedRoot = PrivateData.verifyFullTree(tree as unknown as Parameters<typeof PrivateData.verifyFullTree>[0]);
        return { computedRoot, matches: computedRoot.toLowerCase() === tree.root.toLowerCase() };
      }),
  ];
}
