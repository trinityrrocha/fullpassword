import { useEffect } from 'react';

const mutatingTextPatterns = [
  /adicionar/i,
  /salvar/i,
  /excluir/i,
  /remover/i,
  /gerar senha/i,
  /desfazer/i
];

const allowedButtonTextPatterns = [
  /detalhes/i,
  /copiar/i,
  /mostrar/i,
  /ocultar/i,
  /cancelar/i,
  /^$/
];

const getButtonText = (button) => [
  button.textContent || '',
  button.getAttribute('title') || '',
  button.getAttribute('aria-label') || ''
].join(' ').trim();

const shouldLockButton = (button) => {
  const text = getButtonText(button);

  if (allowedButtonTextPatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  return mutatingTextPatterns.some((pattern) => pattern.test(text));
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
  if (button.dataset.vaultReadonlyButtonLocked === 'true') return;

  button.dataset.vaultReadonlyButtonLocked = 'true';
  button.disabled = true;
  button.classList.add('opacity-50', 'cursor-not-allowed');
};

const unlockButton = (button) => {
  if (button.dataset.vaultReadonlyButtonLocked !== 'true') return;

  delete button.dataset.vaultReadonlyButtonLocked;
  button.disabled = false;
  button.classList.remove('opacity-50', 'cursor-not-allowed');
};

const applyReadOnlyState = (enabled) => {
  const roots = Array.from(document.querySelectorAll('[data-vault-readonly-scope]'));

  roots.forEach((root) => {
    const isScopeReadOnly = enabled && root.getAttribute('data-vault-readonly-scope') === 'true';
    const controls = root.querySelectorAll('input, textarea, select');
    const buttons = root.querySelectorAll('button');

    controls.forEach((control) => {
      if (isScopeReadOnly) lockControl(control);
      else unlockControl(control);
    });

    buttons.forEach((button) => {
      if (isScopeReadOnly && shouldLockButton(button)) lockButton(button);
      else unlockButton(button);
    });
  });
};

export default function VaultReadOnlyGuard({ enabled }) {
  useEffect(() => {
    applyReadOnlyState(enabled);

    const observer = new MutationObserver(() => applyReadOnlyState(enabled));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-vault-readonly-scope']
    });

    return () => {
      observer.disconnect();
      applyReadOnlyState(false);
    };
  }, [enabled]);

  return null;
}
