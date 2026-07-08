export default function clientVaultClientHeaderPlugin() {
  return {
    name: 'client-vault-client-header-transform',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('ClientVault.jsx')) return null

      let next = code

      next = next.replace(
        `  // Mock do cliente atual
  const client = { id, name: 'Acme Corp', address: 'Av. Paulista, 1000 - SP' };`,
        `  const [client, setClient] = useState({ id, name: 'Carregando cliente...', address: '' });

  const loadClient = async () => {
    try {
      const response = await api.get('/clients');
      const matchedClient = (response.data || []).find((item) => String(item.id) === String(id));
      if (matchedClient) {
        setClient(matchedClient);
      } else {
        setClient({ id, name: 'Cliente não encontrado', address: '' });
      }
    } catch (error) {
      console.error('Erro ao carregar cliente:', error);
      setClient({ id, name: 'Cliente não encontrado', address: '' });
    }
  };

  useEffect(() => {
    loadClient();
  }, [id]);`
      )

      next = next.replace(
        `<SecurePasswordInput name="unlock_password" label="Senha Mestre" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} required />`,
        `<SecurePasswordInput name="unlock_password" label="Senha Mestre" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} required enableGenerator={false} />`
      )

      return next === code ? null : { code: next, map: null }
    }
  }
}
