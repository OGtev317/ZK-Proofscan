/** Published references, not security endorsements or an independent chain view. */
export const SOROSWAP_DEPLOYMENT = {
  network: 'stellar-mainnet',
  router: 'CAG5LRYQ5JVEUI5TEID72EYOVX44TTUJT5BQR2J6J77FH65PCCFAJDDH',
  codeSha256: '4c3db3ebd2d6a2ab23de1f622eaabb39501539b4611b68622ec4e47f76c4ba07',
  source: 'https://github.com/soroswap/core/blob/6eade008ee6794075ad941609e0fef0d1124d3eb/public/mainnet.contracts.json',
} as const;

export function soroswapDeploymentMatch(network: string | undefined, contract: string, codeHash: string): boolean {
  return network === SOROSWAP_DEPLOYMENT.network && contract === SOROSWAP_DEPLOYMENT.router && codeHash === SOROSWAP_DEPLOYMENT.codeSha256;
}
