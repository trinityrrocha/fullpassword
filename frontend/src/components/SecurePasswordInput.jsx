import { useState } from 'react';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

export default function SecurePasswordInput({ 
  value, 
  onChange, 
  name, 
  placeholder = "Senha", 
  label = "Senha",
  required = false,
  className = ""
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

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

  return (
    <div className={`flex flex-col ${className}`}>
      {label && (
        <label htmlFor={name} className="block text-sm font-medium text-slate-700 mb-1">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}
      <div className="relative rounded-md shadow-sm">
        <input
          type={showPassword ? "text" : "password"}
          name={name}
          id={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          className="block w-full rounded-md border-slate-300 pr-20 focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2.5 bg-white"
        />
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          <button
            type="button"
            onClick={copyToClipboard}
            className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
            title="Copiar senha"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={togglePasswordVisibility}
            className="p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors ml-1"
            title={showPassword ? "Ocultar senha" : "Mostrar senha"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
