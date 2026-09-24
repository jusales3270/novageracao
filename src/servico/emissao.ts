import { randomUUID } from 'node:crypto';
import { PedidoMatricula, type CanalImagem } from '../dominio/tipos.js';
import { avalia, anuidadeDerivada, buscaLinha, type VereditoFinal } from '../motor/index.js';
import { RegistroConsentimento } from '../consentimento/modelo.js';
import { comEscola } from '../db/pool.js';
import * as repo from '../db/repos.js';
import { registra } from '../db/ledger.js';
import { geraDocumentos } from '../documentos/render.js';
import { grava, caminhoDe } from '../documentos/armazenamento.js';
import { enviaEnvelope, type Signatario } from '../assinatura/envelope.js';
import { DocusignClient } from '../assinatura/docusign-client.js';
import type { Usuario } from '../auth/sessao.js';

/**
 * O pedido chega do navegador. O operador e o perfil chegam da SESSÃO.
 * Tudo que o motor precisa — tabela, testemunhas, DPA, ambiente — vem do banco.
 * O navegador não consegue influenciar nenhuma entrada do veredito além dos dados do aluno.
 */

function comOperador(bruto: unknown, u: Usuario) {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  return PedidoMatricula.parse({ ...b, operador: { nome: u.nome, papel: u.papel } });
}

export const clienteDocusign = () => new DocusignClient({
  integrationKey: process.env.DS_INTEGRATION_KEY ?? '',
  userId: process.env.DS_USER_ID ?? '',
  privateKeyPem: (process.env.DS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  oauthBase: process.env.DS_OAUTH_BASE ?? 'account-d.docusign.com',
  mock: process.env.DS_MODO !== 'real',
});

/* ------------------------------ simular ------------------------------ */

export async function simular(bruto: unknown, u: Usuario) {
  const pedido = comOperador(bruto, u);
  return comEscola(u.escola_id, async (tx) => {
    const { ctx } = await repo.contexto(tx, u.escola_id, pedido.anoLetivo);
    const v = avalia(pedido, ctx);
    return { decisao: v.decisao, calculo: v.calculo, vereditos: v.vereditos,
             bloqueios: v.bloqueios, alertas: v.alertas, assinaturaLogica: v.assinaturaLogica };
  });
}

/* ------------------------------- emitir ------------------------------- */

export async function emitir(bruto: unknown, u: Usuario) {
  const pedido = comOperador(bruto, u);
  const id = `MAT-${pedido.anoLetivo}-${randomUUID().slice(0, 8).toUpperCase()}`;

  // 1 · veredito + cadastro, atômico. Bloqueio também é gravado: a recusa é evidência.
  const etapa1 = await comEscola(u.escola_id, async (tx) => {
    const c = await repo.contexto(tx, u.escola_id, pedido.anoLetivo);
    const v: VereditoFinal = avalia(pedido, c.ctx);
    await registra(tx, u.escola_id, id, 'PEDIDO_RECEBIDO', u.email,
      { turma: pedido.servicos.turma, periodo: pedido.servicos.periodo, tipo: pedido.tipo });
    await repo.gravaMatricula(tx, u.escola_id, id, pedido, { id: u.id, papel: u.papel }, c.tabelaId, v);
    await registra(tx, u.escola_id, id, v.decisao === 'LIBERADO' ? 'VEREDITO_MOTOR' : 'BLOQUEIO_MOTOR', 'motor',
      { decisao: v.decisao, assinaturaLogica: v.assinaturaLogica,
        bloqueios: v.bloqueios.map((b) => ({ regra: b.regra, achado: b.achado ?? null })) });
    for (const k of pedido.consentimentos) {
      await registra(tx, u.escola_id, id, k.concedido ? 'CONSENTIMENTO_REGISTRADO' : 'CONSENTIMENTO_NEGADO',
        k.porNome, { canal: k.canal, concedido: k.concedido });
    }
    return { v, c };
  });

  if (etapa1.v.decisao !== 'LIBERADO' || !etapa1.v.calculo) {
    return { ok: false as const, matriculaId: id, decisao: etapa1.v.decisao, bloqueios: etapa1.v.bloqueios };
  }

  const { v, c } = etapa1;
  const calculo = v.calculo!;
  const consent = new RegistroConsentimento(id);
  for (const k of pedido.consentimentos) consent.registrar(k);

  // 2 · documentos. Fora da transação: PDF é lento e não deve segurar conexão.
  const docs = await geraDocumentos({
    matriculaId: id, pedido, calculo,
    consentimentos: consent.estadoEm(),
    testemunhas: c.ctx.testemunhas,
    assinaturaLogica: v.assinaturaLogica,
    geradoEm: new Date().toISOString(),
    anuidadeDerivada: anuidadeDerivada(buscaLinha(c.ctx.tabela, pedido.servicos.turma, pedido.servicos.periodo)),
  });

  const docIds = await comEscola(u.escola_id, async (tx) => {
    const out: { id: string; tipo: string; nome: string; sha256: string; bytes: number }[] = [];
    for (const [tipo, d] of [['REQUERIMENTO', docs.requerimento], ['CONTRATO', docs.contrato]] as const) {
      const caminho = caminhoDe(u.escola_id, id, d.nome);
      await grava(caminho, d.buffer);
      const docId = await repo.gravaDocumento(tx, u.escola_id, id, { tipo, nome: d.nome, sha256: d.sha256, bytes: d.bytes, caminho });
      // hash gravado ANTES do envio: prova depois que o assinado é o que foi gerado
      await registra(tx, u.escola_id, id, 'DOCUMENTO_GERADO', 'motor', { tipo, sha256: d.sha256, bytes: d.bytes });
      out.push({ id: docId, tipo, nome: d.nome, sha256: d.sha256, bytes: d.bytes });
    }
    await repo.statusMatricula(tx, id, 'documentos_gerados');
    return out;
  });

  // 3 · envelope
  const signatarios: Signatario[] = [
    { nome: pedido.contratante.nome, email: pedido.contratante.email, cpf: pedido.contratante.cpf, papel: 'CONTRATANTE', ordem: 1 },
  ];
  if (pedido.responsavelFinanceiro.cpf !== pedido.contratante.cpf) {
    signatarios.push({ nome: pedido.responsavelFinanceiro.nome, email: pedido.responsavelFinanceiro.email,
      cpf: pedido.responsavelFinanceiro.cpf, papel: 'RESPONSAVEL_FINANCEIRO', ordem: 2 });
  }
  signatarios.push({ nome: c.escola.razao_social, email: c.escola.email_contato, papel: 'ESCOLA', ordem: 3 });
  for (const t of c.testemunhasCompletas) signatarios.push({ nome: t.nome, email: t.email, cpf: t.cpf, papel: 'TESTEMUNHA', ordem: 4 });

  const cli = clienteDocusign();
  let envelope: { envelopeId: string; status: string };
  try {
    envelope = await enviaEnvelope(cli, {
      matriculaId: id, alunoNome: pedido.aluno.nome, anoLetivo: pedido.anoLetivo,
      webhookUrl: process.env.DS_WEBHOOK, signatarios,
      documentos: [
        { id: '1', nome: 'Requerimento de matrícula.pdf', base64: docs.requerimento.buffer.toString('base64') },
        { id: '2', nome: 'Contrato de prestação de serviços educacionais.pdf', base64: docs.contrato.buffer.toString('base64') },
      ],
    });
  } catch (e) {
    await comEscola(u.escola_id, async (tx) => {
      await repo.statusMatricula(tx, id, 'falha_envio');
      await registra(tx, u.escola_id, id, 'FALHA_ENVIO', 'sistema', { erro: String((e as Error).message).slice(0, 300) });
    });
    return { ok: false as const, matriculaId: id, decisao: 'LIBERADO' as const, falhaEnvio: true, documentos: docIds };
  }

  await comEscola(u.escola_id, async (tx) => {
    await repo.gravaEnvelope(tx, u.escola_id, id,
      { envelopeId: envelope.envelopeId, status: envelope.status, modo: cli.emMock ? 'MOCK' : 'DOCUSIGN' }, signatarios);
    await registra(tx, u.escola_id, id, 'ENVELOPE_ENVIADO', 'sistema',
      { envelopeId: envelope.envelopeId, signatarios: signatarios.length, modo: cli.emMock ? 'MOCK' : 'DOCUSIGN' });
  });

  return {
    ok: true as const, matriculaId: id, decisao: 'LIBERADO' as const,
    assinaturaLogica: v.assinaturaLogica, calculo,
    documentos: docIds,
    envelope: { id: envelope.envelopeId, status: envelope.status, modo: cli.emMock ? 'MOCK' : 'DOCUSIGN' },
    signatarios: signatarios.map(({ nome, papel, ordem }) => ({ nome, papel, ordem })),
  };
}

/* ------------------------ revogar consentimento ------------------------ */

/** Cl. 16ª: revogável a qualquer tempo. Novo evento com vigência; nada é apagado. */
export async function revogar(matriculaId: string, canal: CanalImagem, u: Usuario, solicitante: { nome: string; cpf: string }) {
  return comEscola(u.escola_id, async (tx) => {
    const m = await tx.query('select 1 from matricula where id = $1', [matriculaId]);
    if (!m.rowCount) throw new Error('Matrícula não encontrada');
    await tx.query(
      `insert into consentimento_imagem (escola_id, matricula_id, canal, concedido, por_cpf, por_nome, canal_coleta)
       values ($1,$2,$3,false,$4,$5,'PRESENCIAL')`,
      [u.escola_id, matriculaId, canal, solicitante.cpf.replace(/\D/g, ''), solicitante.nome]);
    await registra(tx, u.escola_id, matriculaId, 'CONSENTIMENTO_REVOGADO', u.email,
      { canal, solicitante: solicitante.nome });
    const r = await tx.query<{ pode: boolean }>('select pode_publicar($1,$2,now()) as pode', [matriculaId, canal]);
    return { canal, podePublicarAgora: r.rows[0]!.pode };
  });
}
