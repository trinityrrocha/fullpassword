import { useState } from 'react';
import { Download } from 'lucide-react';

const sanitizeEmailForFilename = (email) => String(email || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/@/g, '-')
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

export default function RecoveryCodesPanel({ codes, userEmail }) {
  const [pdfError, setPdfError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  if (!Array.isArray(codes) || codes.length === 0) return null;

  const saveAsPdf = async () => {
    setPdfError('');
    setIsGenerating(true);
    try {
      const { jsPDF } = await import('jspdf');
      const document = new jsPDF({ unit: 'mm', format: 'a4' });
      const generatedAt = new Date();
      const safeEmail = String(userEmail || '').trim();
      const filenameEmail = sanitizeEmailForFilename(safeEmail);
      const datePart = [
        generatedAt.getFullYear(),
        String(generatedAt.getMonth() + 1).padStart(2, '0'),
        String(generatedAt.getDate()).padStart(2, '0')
      ].join('-');

      document.setFont('helvetica', 'bold');
      document.setFontSize(18);
      document.text('FullPassword — Códigos de Recuperação MFA', 20, 24);

      document.setFont('helvetica', 'normal');
      document.setFontSize(11);
      document.text('Guarde estes códigos em local seguro.', 20, 34);
      document.text(`Gerado em: ${generatedAt.toLocaleString()}`, 20, 43);
      if (safeEmail) document.text(`Usuário: ${safeEmail}`, 20, 51);

      const listStart = safeEmail ? 64 : 56;
      document.setFont('courier', 'normal');
      document.setFontSize(12);
      codes.forEach((code, index) => {
        document.text(`${index + 1}. ${code}`, 25, listStart + (index * 8));
      });

      const warningStart = listStart + (codes.length * 8) + 8;
      document.setFont('helvetica', 'bold');
      document.setFontSize(11);
      document.text('Avisos de segurança', 20, warningStart);
      document.setFont('helvetica', 'normal');
      [
        'Cada código pode ser usado apenas uma vez.',
        'Não compartilhe este arquivo.',
        'Não armazene este PDF junto com sua senha.',
        'Se suspeitar de vazamento, gere novos códigos de recuperação.'
      ].forEach((warning, index) => document.text(`• ${warning}`, 20, warningStart + 8 + (index * 7)));

      document.setFontSize(9);
      document.setTextColor(90);
      document.text(
        'Gerado localmente no navegador. O sistema não armazena estes códigos em texto puro.',
        20,
        285
      );

      document.save(`fullpassword-recovery-codes-${filenameEmail ? `${filenameEmail}-` : ''}${datePart}.pdf`);
    } catch {
      setPdfError('Não foi possível gerar o PDF.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <p className="font-medium text-amber-900">Guarde estes códigos de recuperação agora</p>
        <p className="text-xs text-amber-700 mt-1">Eles não serão exibidos novamente. Cada código pode ser usado apenas uma vez.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => <div key={code} className="rounded bg-white/70 px-3 py-2">{code}</div>)}
      </div>
      <button type="button" onClick={saveAsPdf} disabled={isGenerating} className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70">
        <Download className="mr-2 h-4 w-4" />
        {isGenerating ? 'Gerando PDF...' : 'Salvar em PDF'}
      </button>
      {pdfError && <p role="alert" className="text-sm text-red-700">{pdfError}</p>}
    </div>
  );
}
