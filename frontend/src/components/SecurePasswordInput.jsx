import { useState, useEffect, useRef } from 'react';
import { Eye, EyeOff, Copy, Check, KeyRound } from 'lucide-react';

// ---------------------------------------------------------------------------
// Geração de senha segura
// ---------------------------------------------------------------------------
const UPPER   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER   = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS  = '0123456789';
const SPECIAL = '!@#$%^&*()_+=[]{}|;:<>?';
const POOL    = UPPER + LOWER + DIGITS + SPECIAL;
const PASSWORD_LENGTH = 20;

/**
 * Retorna um índice aleatório no intervalo [0, max) usando rejection sampling
 * para eliminar viés de módulo.
 */
function secureRandomIndex(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do {
    window.crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/**
 * Embaralha um array in-place usando Fisher-Yates com window.crypto.
 */
function cryptoShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Gera uma senha de 20 caracteres garantindo ao menos 1 de cada categoria.
 */
function generateSecurePassword() {
  // Garante pelo menos 1 de cada categoria
  const mandatory = [
    UPPER[secureRandomIndex(UPPER.length)],
    LOWER[secureRandomIndex(LOWER.length)],
    DIGITS[secureRandomIndex(DIGITS.length)],
    SPECIAL[secureRandomIndex(SPECIAL.length)],
  ];

  // Preenche o restante com caracteres aleatórios do pool completo
  const rest = Array.from({ length: PASSWORD_LENGTH - mandatory.length }, () =>
    POOL[secureRandomIndex(POOL.length)]
  );

  // Embaralha tudo com Fisher-Yates criptográfico
  return cryptoShuffle([...mandatory, ...rest]).join('');
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------
export default function SecurePasswordInput({
  value,
  onChange,
  name,
  placeholder = 'Senha',
  label = 'Senha',
  required = false,
  className = '',
  enableGenerator = true,
}) {
  const [showPassword, setShowPassword]     = useState(false);
  const [copied, setCopied]                 = useState(false);
  const [previousValue, setPreviousValue]   = useState(null);
  const [showUndo, setShowUndo]             = useState(false);
  const undoTimerRef                        = useRef(null);

  // Limpa o timer de undo ao desmontar
  useEffect(() => () => clearTimeout(undoTimerRef.current), []);

  // -------------------------------------------------------------------------
  // Copiar senha
  // -------------------------------------------------------------------------
  const copyToClipboard = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Falha ao copiar senha', err);
    }
  };

  // -------------------------------------------------------------------------
  // Gerar senha
  // -------------------------------------------------------------------------
  const handleGenerate = () => {
    if (!enableGenerator) return;

    const newPassword = generateSecurePassword();

    const applyNewPassword = () => {
      // Preserva sempre a senha original antes da primeira geração.
      // Gerações seguintes não podem sobrescrever o valor usado pelo Desfazer.
      setPreviousValue((currentPreviousValue) => (
        currentPreviousValue === null ? (value || '') : currentPreviousValue
      ));

      // Dispara o onChange simulando um evento nativo
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set;
      const inputEl = document.getElementById(name);
      if (inputEl && nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, newPassword);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Fallback: chama onChange diretamente com objeto sintético
        onChange({ target: { value: newPassword } });
      }

      // Exibe aviso de desfazer por 10 segundos
      setShowUndo(true);
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => {
        setShowUndo(false);
        setPreviousValue(null);
      }, 10000);
    };

    if (value) {
      const confirmed = window.confirm(
        'Atenção: Já existe uma senha preenchida neste campo. Deseja substituí-la por uma nova senha aleatória?'
      );
      if (!confirmed) return;
    }

    applyNewPassword();
  };

  // -------------------------------------------------------------------------
  // Desfazer
  // -------------------------------------------------------------------------
  const handleUndo = () => {
    if (previousValue === null) return;
    onChange({ target: { value: previousValue } });
    setShowUndo(false);
    setPreviousValue(null);
    clearTimeout(undoTimerRef.current);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className={`flex flex-col ${className}`}>
      {label && (
        <label htmlFor={name} className="block text-sm font-medium text-slate-700 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <div className="relative rounded-md shadow-sm">
        <input
          type={showPassword ? 'text' : 'password'}
          name={name}
          id={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className={`block w-full rounded-md border-slate-300 ${enableGenerator ? 'pr-28' : 'pr-20'} focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5 bg-white`}
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-0.5">
          {enableGenerator && (
            <button
              type="button"
              onClick={handleGenerate}
              className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
              aria-label="Gerar senha segura"
              title="Gerar senha segura"
            >
              <KeyRound className="h-4 w-4" />
            </button>
          )}

          {/* Copiar senha */}
          <button
            type="button"
            onClick={copyToClipboard}
            className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
            title="Copiar senha"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>

          {/* Mostrar / ocultar senha */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
            title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Aviso de desfazer */}
      {enableGenerator && showUndo && (
        <div className="mt-1 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          <span>Senha gerada automaticamente.</span>
          <button
            type="button"
            onClick={handleUndo}
            className="font-semibold underline hover:text-amber-900 focus:outline-none"
          >
            Desfazer
          </button>
        </div>
      )}
    </div>
  );
}
