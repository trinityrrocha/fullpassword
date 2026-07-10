import { useEffect } from 'react';

const actionPatterns = {
  add: [/adicionar/i, /novo/i, /nova/i, /cadastrar/i, /incluir/i],
  edit: [/salvar/i, /gerar senha/i, /desfazer/i],
  delete: [/excluir/i, /remover/i, /apagar/i, /deletar/i]
};

const allowedButtonTextPatterns = [
  /detalhes/i,
  /copiar/i,
  /mostrar/i,
  /ocultar/i,
  /cancelar/i
];

const getButtonText = (button) => [
  button.textContent || '',
  button.getAttribute('title') || '',
  button.getAttribute('aria-label') || ''
].join(' ').trim();

const getButtonAction = (button) => {
  const explicitAction = button.getAttribute('data-vault-action');
  if (explicitAction) return explicitAction;

  const text = getButtonText(button);

  if (allowedButtonTextPatterns.some((pattern) => pattern.test(text))) {
    return 'allowed';
  }

  for (const [action, patterns] of Object.entries(actionPatterns)) {
    if (patterns.some((pattern) => pattern.test(text))) return action;
  }

  return 'unknown';
};

const shouldLockButton = (button, permissions) => {
  const action = getButtonAction(button);

  if (action === 'allowed') return false;
  if (permissions.readOnly && action !== 'allowed') return action !== 'unknown';
  if (action === 'add') return !permissions.canAdd;
  if (action === 'edit') return !permissions.canEdit;
  if (action === 'delete') return !permissions.canDelete;

  return false;
};

const lockControl = (control) => {
  if (control.dataset.vaultReadonlyLocked === 'true') return;

  control.dataset.vaultReadonlyLocked = 'true';

  if (control.tagName === 'INPUT' || control.tagName === 'TEXTAREA') {
    control.readOnly = true;
    control.classList.add('bg-slate-50', 'cursor-default');
    return;
  }

  if (control.tagName === 'SELECT') {
    control.disabled = true;
    control.classList.add('bg-slate-50', 'cursor-not-allowed');
  }
};

const unlockControl = (control) => {
  if (control.dataset.vaultReadonlyLocked !== 'true') return;

  delete control.dataset.vaultReadonlyLocked;

  if (control.tagName === 'INPUT' || control.tagName === 'TEXTAREA') {
    control.readOnly = false;
    control.classList.remove('bg-slate-50', 'cursor-default');
    return;
  }

  if (control.tagName === 'SELECT') {
    control.disabled = false;
    control.classList.remove('bg-slate-50', 'cursor-not-allowed');
  }
};

const lockButton = (button) => {
  button.dataset.vaultPermissionButtonLocked = 'true';
  button.disabled = true;
  button.setAttribute('aria-disabled', 'true');
  button.classList.add('opacity-50', 'cursor-not-allowed');
};

const unlockButton = (button) => {
  if (button.dataset.vaultPermissionButtonLocked !== 'true') return;

  delete button.dataset.vaultPermissionButtonLocked;
  button.disabled = false;
  button.removeAttribute('aria-disabled');
  button.classList.remove('opacity-50', 'cursor-not-allowed');
};

const normalizePermissions = (permissions = {}) => {
  const canView = Boolean(permissions.can_view ?? permissions.canView ?? true);
  const isOwner = Boolean(permissions.is_owner ?? permissions.isOwner ?? false);
  const isAdmin = Boolean(permissions.is_admin ?? permissions.isAdmin ?? false);

  if (isOwner || isAdmin) {
    return {
      readOnly: false,
      canAdd: true,
      canEdit: true,
      canDelete: true
    };
  }

  const canEdit = Boolean(permissions.can_edit ?? permissions.canEdit ?? false);
  const canAdd = Boolean(permissions.can_add ?? permissions.canAdd ?? false);
  const canDelete = Boolean(permissions.can_delete ?? permissions.canDelete ?? false);

  return {
    readOnly: canView && !canEdit && !canAdd && !canDelete,
    canAdd,
    canEdit,
    canDelete
  };
};

const applyPermissionState = (permissions) => {
  const normalized = normalizePermissions(permissions);
  const roots = Array.from(document.querySelectorAll('[data-vault-readonly-scope]'));

  roots.forEach((root) => {
    const isScopeReadOnly = normalized.readOnly && root.getAttribute('data-vault-readonly-scope') === 'true';
    const controls = root.querySelectorAll('input, textarea, select');
    const buttons = root.querySelectorAll('button');

    controls.forEach((control) => {
      if (isScopeReadOnly) lockControl(control);
      else unlockControl(control);
    });

    buttons.forEach((button) => {
      if (shouldLockButton(button, normalized)) lockButton(button);
      else unlockButton(button);
    });
  });
};

const isInsideVaultScope = (target) => Boolean(target?.closest?.('[data-vault-readonly-scope]'));

export default function VaultReadOnlyGuard({ enabled, permissions }) {
  useEffect(() => {
    const effectivePermissions = permissions || { can_view: true, can_edit: !enabled, can_add: !enabled, can_delete: !enabled };
    let animationFrame = null;

    const scheduleApply = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        applyPermissionState(effectivePermissions);
      });
    };

    const handleClickCapture = (event) => {
      if (!isInsideVaultScope(event.target)) return;

      const button = event.target.closest?.('button');
      if (!button) return;

      const normalized = normalizePermissions(effectivePermissions);
      if (!shouldLockButton(button, normalized)) return;

      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent?.stopImmediatePropagation?.();
      lockButton(button);
    };

    scheduleApply();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'class', 'aria-disabled', 'data-vault-readonly-scope']
    });

    document.addEventListener('click', handleClickCapture, true);

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [enabled, permissions]);

  return null;
}
