export default {
  input: {
    index: 'src/index.ts',
    organizationIdentity: 'src/organizationIdentity.ts',
    'accountPlatform/index': 'src/accountPlatform/index.ts',
    'accountPlatform/boundary': 'src/accountPlatform/boundary.ts',
  },
  output: { dir: 'dist/esm', format: 'esm' },
};
