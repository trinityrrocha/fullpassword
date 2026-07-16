export default function clientVaultSharingPlugin() {
  return {
    name: 'client-vault-sharing-transform',
    enforce: 'pre',
    transform() {
      // ClientVault now owns the sharing, key recovery and permission guards.
      // Keep this registered plugin as a no-op to avoid injecting the legacy flow.
      return null
    }
  }
}
