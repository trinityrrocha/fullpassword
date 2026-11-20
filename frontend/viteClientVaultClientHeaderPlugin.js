export default function clientVaultClientHeaderPlugin() {
  return {
    name: 'client-vault-client-header-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      // The client name is now loaded in ClientVault.jsx itself; only the unlock field tweak remains.
      next = next.replace(
        `<SecurePasswordInput name="unlock_password" label="Senha Mestre" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} required />`,
        `<SecurePasswordInput name="unlock_password" label="Senha Mestre" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} required enableGenerator={false} />`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}
