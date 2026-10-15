// The one part of @stellar/js-xdr this tool uses, which ships no declarations of its own.
declare module '@stellar/js-xdr' {
  const lib: { XdrReader: new (buffer: Uint8Array) => { eof: boolean } };
  export default lib;
}
