import type { Environment } from 'aws-cdk-lib'

export type EnvName = 'staging' | 'production'

export const PRODUCT = 'template'

// biome-ignore lint/complexity/useLiteralKeys: tsconfig's noPropertyAccessFromIndexSignature requires bracket access on index-signature types
const account = process.env['CDK_DEFAULT_ACCOUNT']

// Region must match aws-region in .github/workflows/deploy-*.yml
export const aws: Environment = {
  region: 'eu-west-1',
  ...(account && { account })
}

export const tagsFor = (env: EnvName) => ({
  Product: PRODUCT,
  Environment: env,
  ManagedBy: 'cdk'
})
