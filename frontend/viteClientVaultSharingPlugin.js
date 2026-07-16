export default function clientVaultSharingPlugin() {
  return {
    name: 'client-vault-sharing-transform',
    enforce: 'pre',
    transform() {
      return null
    }
  }
}
