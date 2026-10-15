export const MIN_LENGTH_OPTIONS = [8,12,16,20];
export const ROTATION_OPTIONS = [6,12,18];
export const PASSWORD_POLICY_CHANGED = 'fullpassword:password-policy-changed';
export const passwordMinimum = (policy, kind) => {
  const minimum = policy?.[kind === 'vault' ? 'vault_min_length' : 'login_min_length'];
  if (!MIN_LENGTH_OPTIONS.includes(minimum)) throw new Error('Não foi possível validar a política de senha. Atualize e tente novamente.');
  return minimum;
};
