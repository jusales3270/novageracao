import type { DocusignClient } from './docusign-client.js';

/**
 * Envelope de matrícula.
 *
 * Achado A-06: o contrato exige duas testemunhas com CPF. São QUATRO
 * signatários por envelope, não dois. Isso muda o custo de assinatura e
 * é o que preserva a força de título executivo extrajudicial do contrato
 * (CPC art. 784, III) — que é o instrumento de cobrança da escola.
 *
 * Ordem de roteamento:
 *   1. Contratante / responsável legal
 *   2. Responsável financeiro (pulado quando é a mesma pessoa)
 *   3. Escola (representante legal)
 *   4. Testemunhas 1 e 2, em paralelo
 */

export interface Signatario {
  nome: string;
  email: string;
  cpf?: string;
  papel: 'CONTRATANTE' | 'RESPONSAVEL_FINANCEIRO' | 'ESCOLA' | 'TESTEMUNHA';
  ordem: number;
}

export interface DocumentoEnvelope {
  nome: string;
  /** PDF em base64. */
  base64: string;
  id: string;
}

export interface EntradaEnvelope {
  matriculaId: string;
  alunoNome: string;
  anoLetivo: number;
  documentos: DocumentoEnvelope[];
  signatarios: Signatario[];
  webhookUrl?: string;
}

/** Âncoras (AutoPlace) impressas nos templates. Ver documentos/*.ts. */
const ANCORA: Record<Signatario['papel'], string> = {
  CONTRATANTE: '/ass_contratante/',
  RESPONSAVEL_FINANCEIRO: '/ass_financeiro/',
  ESCOLA: '/ass_escola/',
  TESTEMUNHA: '/ass_testemunha/',
};

export function montaDefinicao(e: EntradaEnvelope) {
  let idx = 0;
  const signers = e.signatarios.map((s) => {
    idx += 1;
    const recipientId = String(idx);
    const ancora = ANCORA[s.papel];
    // Testemunhas compartilham a mesma âncora; a unidade fica no
    // anchorUnits + offset para não colidirem no mesmo ponto.
    const offsetY = s.papel === 'TESTEMUNHA' ? (idx % 2 === 0 ? 0 : 40) : 0;
    return {
      recipientId,
      routingOrder: String(s.ordem),
      name: s.nome,
      email: s.email,
      roleName: s.papel,
      tabs: {
        signHereTabs: [
          {
            anchorString: ancora,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: String(offsetY),
            anchorIgnoreIfNotPresent: 'false',
          },
        ],
        dateSignedTabs: [
          {
            anchorString: ancora,
            anchorUnits: 'pixels',
            anchorXOffset: '240',
            anchorYOffset: String(offsetY),
          },
        ],
        ...(s.cpf
          ? {
              textTabs: [
                {
                  tabLabel: `cpf_${recipientId}`,
                  anchorString: ancora,
                  anchorUnits: 'pixels',
                  anchorXOffset: '0',
                  anchorYOffset: String(offsetY + 26),
                  value: formataCpf(s.cpf),
                  locked: 'true',
                },
              ],
            }
          : {}),
      },
    };
  });

  return {
    emailSubject: `Matrícula ${e.anoLetivo} — ${e.alunoNome} — Grupo Nova Geração`,
    emailBlurb:
      'Segue o requerimento de matrícula e o contrato de prestação de serviços educacionais para assinatura.',
    status: 'sent' as const,
    documents: e.documentos.map((d, i) => ({
      documentId: d.id || String(i + 1),
      name: d.nome,
      fileExtension: 'pdf',
      documentBase64: d.base64,
    })),
    recipients: { signers },
    ...(e.webhookUrl
      ? {
          eventNotification: {
            url: e.webhookUrl,
            requireAcknowledgment: 'true',
            includeDocuments: 'false',
            includeCertificateOfCompletion: 'true',
            envelopeEvents: [
              { envelopeEventStatusCode: 'sent' },
              { envelopeEventStatusCode: 'delivered' },
              { envelopeEventStatusCode: 'completed' },
              { envelopeEventStatusCode: 'declined' },
              { envelopeEventStatusCode: 'voided' },
            ],
            recipientEvents: [
              { recipientEventStatusCode: 'Completed' },
              { recipientEventStatusCode: 'Declined' },
            ],
          },
        }
      : {}),
    customFields: {
      textCustomFields: [
        { name: 'matriculaId', value: e.matriculaId, show: 'false' },
        { name: 'anoLetivo', value: String(e.anoLetivo), show: 'false' },
      ],
    },
  };
}

export interface RespostaEnvelope {
  envelopeId: string;
  status: string;
  statusDateTime?: string;
}

export async function enviaEnvelope(
  cli: DocusignClient,
  e: EntradaEnvelope,
): Promise<RespostaEnvelope> {
  const def = montaDefinicao(e);

  const r = await cli.chama<RespostaEnvelope>('POST', '/envelopes', def);

  return r;
}

export async function consultaStatus(cli: DocusignClient, envelopeId: string) {
  return cli.chama<{ status: string; signers?: unknown[] }>(
    'GET',
    `/envelopes/${envelopeId}/recipients`,
  );
}

const formataCpf = (c: string) =>
  c.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
