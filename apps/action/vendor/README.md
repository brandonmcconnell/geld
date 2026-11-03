# Provider runner source dependency

`zod-4.5.4.tgz` is the unchanged public package archive from
`https://registry.npmjs.org/zod/-/zod-4.5.4.tgz`.
It is retained for offline bundle verification, its original MIT notice, and runtime corresponding-source delivery in the provider image.
Its `package/LICENSE` text is unmodified.

- Frozen-lock integrity: `sha512-sC95tT5iHHH9gtpj6A81kh+NEaRAUFN+qlUPDUbRfOMvNf5QCBqsb3WgvnpVtK5Y+4UfA6KqufotuTvMGiTlsA==`
- Archive SHA256: `51f51d886af1428713bf52b4e795afa43e2b43956b8483c9a92590f4c5a7b296`
- Original1072byte LICENSE SHA256: `3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8`

The archive matches the reviewed pnpm lockfile; every one of the93 active bundled Zod modules matches it, and it includes324 TypeScript source files.
The preparer checks integrity and notice bytes again and refuses unreviewed runtime dependencies or versions.
The source archive is not a replacement or relicensing of Zod.
Offline rebuilding also requires the declared frozen build dependencies to be installed or cached; retaining this runtime source does not make the whole toolchain self-contained.
