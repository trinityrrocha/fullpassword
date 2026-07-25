import { useEffect, useState } from 'react';
import { Copy, Download } from 'lucide-react';

const sanitizeEmailForFilename = (email) => String(email || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/@/g, '-')
  .replace(/[^a-z0-9-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

export default function RecoveryCodesPanel({ codes, userEmail, onSaved, onAcknowledged }) {
  const [pdfError, setPdfError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [PdfDocument, setPdfDocument] = useState(null);

  useEffect(() => {
    let active = true;
    import('jspdf')
      .then(({ jsPDF }) => {
        if (active) setPdfDocument(() => jsPDF);
      })
      .catch(() => {
        if (active) {
          setPdfError('Não foi possível preparar o PDF. Copie os códigos antes de fechar esta janela.');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  if (!Array.isArray(codes) || codes.length === 0) return null;

  const saveAsPdf = () => {
    setPdfError('');
    if (!PdfDocument) {
      setPdfError('O gerador de PDF ainda está carregando. Tente novamente em alguns instantes.');
      return;
    }
    setIsGenerating(true);
    try {
      const document = new PdfDocument({ unit: 'mm', format: 'a4' });
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
      document.text('Use-os apenas se você perder acesso ao aplicativo autenticador.', 20, 41);
      document.text(`Gerado em: ${generatedAt.toLocaleString()}`, 20, 49);
      if (safeEmail) document.text(`Usuário: ${safeEmail}`, 20, 57);

      const listStart = safeEmail ? 70 : 62;
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
        'Eles não recuperam sua senha mestre, não descriptografam cofres e não substituem sua senha.',
        'Não compartilhe este arquivo.',
        'Não armazene este PDF junto com sua senha.',
        'Se suspeitar de vazamento, gere novos códigos de recuperação.'
      ].forEach((warning, index) => {
        const lines = document.splitTextToSize(`• ${warning}`, 170);
        document.text(lines, 20, warningStart + 8 + (index * 10));
      });

      document.setFontSize(9);
      document.setTextColor(90);
      document.text(
        'Gerado localmente no navegador. O sistema não armazena estes códigos em texto puro.',
        20,
        285
      );

      document.save(`fullpassword-codigos-recuperacao-mfa-${filenameEmail ? `${filenameEmail}-` : ''}${datePart}.pdf`);
      onSaved?.('pdf');
    } catch {
      setPdfError('Não foi possível gerar o PDF. Tente novamente ou copie os códigos antes de fechar esta janela.');
    } finally {
      setIsGenerating(false);
    }
  };

  const copyCodes = async () => {
    setCopyFeedback('');
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopyFeedback('Códigos copiados!');
      onSaved?.('clipboard');
    } catch {
      setCopyFeedback('Não foi possível copiar os códigos.');
    }
  };

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
      <div>
        <p className="font-medium text-amber-900">Guarde estes códigos em local seguro.</p>
        <p className="mt-1 text-xs text-amber-700">
          Eles servem para recuperar o acesso ao MFA caso você perca o aplicativo autenticador. Cada código pode ser usado apenas uma vez.
        </p>
        <p className="mt-1 text-xs text-amber-700">
          Eles não recuperam sua senha mestre e não descriptografam cofres. Estes códigos não serão exibidos novamente.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => <div key={code} className="rounded bg-white/70 px-3 py-2">{code}</div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copyCodes} className="inline-flex items-center justify-center rounded-md border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50">
          <Copy className="mr-2 h-4 w-4" />
          Copiar códigos
        </button>
        <button type="button" onClick={saveAsPdf} disabled={isGenerating || !PdfDocument} className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70">
          <Download className="mr-2 h-4 w-4" />
          {isGenerating ? 'Gerando PDF...' : !PdfDocument ? 'Preparando PDF...' : 'Baixar PDF dos códigos'}
        </button>
      </div>
      {copyFeedback && <p role="status" className="text-sm text-amber-800">{copyFeedback}</p>}
      {pdfError && <p role="alert" className="text-sm text-red-700">{pdfError}</p>}
      {onAcknowledged && (
        <button type="button" onClick={onAcknowledged} className="text-sm font-medium text-indigo-700 underline hover:text-indigo-900">
          Confirmar que guardei os códigos
        </button>
      )}
    </div>
  );
}
