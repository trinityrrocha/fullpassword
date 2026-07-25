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
