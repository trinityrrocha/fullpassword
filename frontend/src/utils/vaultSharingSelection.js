export const normalizeVaultShare = (share = {}) => ({
  group_id: share.group_id || share.groupId || share.id || '',
  group_name: share.group_name || share.groupName || share.name || '',
  group_description: share.group_description || share.groupDescription || share.description || '',
  can_view: Boolean(share.can_view ?? share.canView ?? true),
  can_edit: Boolean(share.can_edit ?? share.canEdit ?? false),
  can_add: Boolean(share.can_add ?? share.canAdd ?? false),
  can_delete: Boolean(share.can_delete ?? share.canDelete ?? false)
});

export const toggleVaultGroupShare = (shares, group) => {
  const currentShares = Array.isArray(shares) ? shares : [];
  const normalizedGroup = normalizeVaultShare(group);
  if (!normalizedGroup.group_id) return currentShares;

  const isSelected = currentShares.some((share) => (
    normalizeVaultShare(share).group_id === normalizedGroup.group_id
  ));

  return isSelected
    ? currentShares.filter((share) => normalizeVaultShare(share).group_id !== normalizedGroup.group_id)
    : [normalizedGroup, ...currentShares];
};

export const getVaultSharingGroupNames = (shares, groups) => {
  const groupMap = new Map(
    (Array.isArray(groups) ? groups : []).map((group) => [group.id, group])
  );

  return (Array.isArray(shares) ? shares : [])
    .map(normalizeVaultShare)
    .map((share) => groupMap.get(share.group_id)?.name || share.group_name)
    .filter(Boolean);
};

// ---- direct user shares (a group AND selected users) ----
export const normalizeUserShare = (share = {}) => ({
  user_id: share.user_id || share.id || '',
  name: share.name || '',
  email_hint: share.email_hint || '',
  has_identity: share.has_identity !== false,
  can_view: true,
  can_edit: Boolean(share.can_edit),
  can_add: Boolean(share.can_add),
  can_delete: Boolean(share.can_delete)
});

// Accounts without a crypto identity cannot receive a key yet: the picker refuses them before the server has to.
export const canPickUser = (user) => Boolean(user?.id) && user.has_identity === true && user.is_active !== false;

export const toggleUserShare = (shares, user) => {
  const current = Array.isArray(shares) ? shares : [];
  if (current.some((share) => share.user_id === user.id)) return current.filter((share) => share.user_id !== user.id);
  if (!canPickUser(user)) return current;
  return [...current, normalizeUserShare({ ...user, user_id: user.id })];
};

export const setUserSharePermission = (shares, userId, key, value) => (Array.isArray(shares) ? shares : [])
  .map((share) => (share.user_id === userId && ['can_edit', 'can_add', 'can_delete'].includes(key) ? { ...share, [key]: Boolean(value) } : share));

// Only what the server needs: ids and rights. Names and hints never travel back.
export const toUserSharesPayload = (shares) => (Array.isArray(shares) ? shares : [])
  .filter((share) => share.user_id)
  .map((share) => ({ user_id: share.user_id, can_view: true, can_edit: share.can_edit, can_add: share.can_add, can_delete: share.can_delete }));

export const sharingSummary = (groupCount, userCount) => {
  const parts = [];
  if (groupCount) parts.push(groupCount === 1 ? '1 grupo' : `${groupCount} grupos`);
  if (userCount) parts.push(userCount === 1 ? '1 usuário' : `${userCount} usuários`);
  return parts.length ? parts.join(' e ') : 'Nenhum grupo ou usuário selecionado';
};
