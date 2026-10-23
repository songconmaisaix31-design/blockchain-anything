declare module 'bs58' {
  const bs58: {
    decode(value: string): Uint8Array;
    encode(value: Uint8Array): string;
  };
  export default bs58;
}
