import type { Tx } from './pool.js';
import type { PedidoMatricula } from '../dominio/tipos.js';
import type { TabelaPrecos } from '../motor/tabela-precos.js';
import type { Contexto, VereditoFinal } from '../motor/index.js';

/* --------------------------- configuração --------------------------- */

export interface Escola {
  id: string; razao_social: string; nome_fantasia: string; cnpj: string;
  endereco: string; cidade: string; email_contato: string;
  ambiente: 'sandbox' | 'homologacao' | 'producao';
  dpa_assinado_em: string | null;
}

export async function escola(tx: Tx, id: string): Promise<Escola> {
  const r = await tx.query<Escola>('select * from escola where id = $1', [id]);
  if (!r.rows[0]) throw new Error('Escola não encontrada');
  return r.rows[0];
}

export async function tabela(tx: Tx, escolaId: string, ano: number): Promise<TabelaPrecos & { id: string }> {
  const t = await tx.query(
    'select * from tabela_preco where escola_id = $1 and ano_letivo = $2', [escolaId, ano]);
  const row = t.rows[0];
  if (!row) throw new Error(`Sem tabela de preços para ${ano}`);
  const l = await tx.query('select * from preco_linha where tabela_id = $1', [row.id]);
  return {
    id: row.id,
    anoLetivo: row.ano_letivo,
    vigenciaInicio: String(row.vigencia_inicio instanceof Date
      ? row.vigencia_inicio.toISOString().slice(0, 10) : row.vigencia_inicio),
    aprovadaPor: row.aprovada_por,
    descontoPontualidadePct: row.desconto_pontualidade_pct,
    matriculaCheia: row.matricula_cheia,
    adicionais: row.adicionais,
    linhas: l.rows.map((x) => ({
      faixa: x.faixa, periodo: x.periodo, mensalidade: x.mensalidade,
      anuidadeDeclaradaContrato: x.anuidade_declarada_legado ?? x.mensalidade * 12,
      alimentacaoInclusa: x.alimentacao_inclusa, descricaoContrato: x.descricao_contrato,
    })),
  };
}

export async function testemunhas(tx: Tx, escolaId: string) {
  const r = await tx.query<{ nome: string; cpf: string; email: string }>(
    'select nome, cpf, email from testemunha where escola_id = $1 and ativa order by nome', [escolaId]);
  return r.rows;
}

/** Monta o contexto do motor inteiramente a partir do banco. Nada vem do cliente. */
export async function contexto(tx: Tx, escolaId: string, ano: number) {
  const [e, t, ts] = await Promise.all([escola(tx, escolaId), tabela(tx, escolaId, ano), testemunhas(tx, escolaId)]);
  const ctx: Contexto = {
    tabela: t,
    testemunhas: ts.map(({ nome, cpf }) => ({ nome, cpf })),
    dpaAssinado: !!e.dpa_assinado_em,
    ambiente: e.ambiente,
  };
  return { ctx, escola: e, tabelaId: t.id, testemunhasCompletas: ts };
}

/* ----------------------------- cadastro ----------------------------- */

async function pessoa(tx: Tx, escolaId: string, p: { nome: string; cpf: string; email: string; telefone: string }) {
  const r = await tx.query<{ id: string }>(
    `insert into pessoa (escola_id, nome, cpf, email, telefone) values ($1,$2,$3,$4,$5)
     on conflict (escola_id, cpf) do update set nome = excluded.nome, email = excluded.email, telefone = excluded.telefone
     returning id`, [escolaId, p.nome, p.cpf, p.email, p.telefone]);
  return r.rows[0]!.id;
}

export async function gravaMatricula(
  tx: Tx, escolaId: string, id: string, pedido: PedidoMatricula,
  operador: { id: string; papel: string }, tabelaId: string, v: VereditoFinal,
) {
  const a = pedido.aluno;
  const al = await tx.query<{ id: string }>(
    `insert into aluno (escola_id, nome, nascimento, endereco, bairro, cidade, cep, irmaos, restricao_judicial)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [escolaId, a.nome, a.nascimento, a.endereco, a.bairro, a.cidade, a.cep, JSON.stringify(a.irmaos), a.restricaoJudicial ?? null]);
  const alunoId = al.rows[0]!.id;

  await tx.query(
    'insert into ficha_saude (aluno_id, escola_id, dados, prescricao_anexada) values ($1,$2,$3,$4)',
    [alunoId, escolaId, JSON.stringify(a.ficha), a.ficha.prescricaoAnexada]);

  for (const x of a.autorizadosRetirada) {
    await tx.query(
      'insert into autorizado_retirada (escola_id, aluno_id, nome, telefone, vinculo) values ($1,$2,$3,$4,$5)',
      [escolaId, alunoId, x.nome, x.telefone, x.vinculo ?? null]);
  }

  const contratanteId = await pessoa(tx, escolaId, pedido.contratante);
  const financeiroId = pedido.responsavelFinanceiro.cpf === pedido.contratante.cpf
    ? contratanteId : await pessoa(tx, escolaId, pedido.responsavelFinanceiro);

  await tx.query(
    `insert into matricula (id, escola_id, aluno_id, contratante_id, financeiro_id, tabela_id, ano_letivo, tipo,
       turma, periodo, servicos, forma_pagamento_matricula, desconto_excepcional_pct, justificativa_desconto,
       operador_id, operador_papel, calculo, decisao_motor, assinatura_logica, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [id, escolaId, alunoId, contratanteId, financeiroId, tabelaId, pedido.anoLetivo, pedido.tipo,
     pedido.servicos.turma, pedido.servicos.periodo, JSON.stringify(pedido.servicos),
     pedido.formaPagamentoMatricula, pedido.descontoExcepcionalPct, pedido.justificativaDesconto ?? null,
     operador.id, operador.papel, v.calculo ? JSON.stringify(v.calculo) : null, v.decisao,
     v.assinaturaLogica, v.decisao === 'LIBERADO' ? 'registrada' : 'recusada']);

  for (const c of pedido.consentimentos) {
    await tx.query(
      `insert into consentimento_imagem (escola_id, matricula_id, canal, concedido, por_cpf, por_nome, canal_coleta, em)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [escolaId, id, c.canal, c.concedido, c.porCpf, c.porNome, c.canalColeta, c.em]);
  }
  return { alunoId };
}

export async function gravaDocumento(tx: Tx, escolaId: string, matriculaId: string,
  d: { tipo: string; nome: string; sha256: string; bytes: number; caminho: string }) {
  const r = await tx.query<{ id: string }>(
    `insert into documento (escola_id, matricula_id, tipo, nome, sha256, bytes, caminho)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [escolaId, matriculaId, d.tipo, d.nome, d.sha256, d.bytes, d.caminho]);
  return r.rows[0]!.id;
}

export async function documento(tx: Tx, id: string) {
  const r = await tx.query<{ id: string; nome: string; caminho: string; sha256: string; matricula_id: string }>(
    `select id, nome, caminho, sha256, matricula_id from documento 
     where id = $1 
       and (nullif(current_setting('app.escola_id', true), '') is null or escola_id = nullif(current_setting('app.escola_id', true), '')::uuid)`,
    [id]);
  return r.rows[0] ?? null;   // RLS: documento de outra escola simplesmente não existe aqui
}

export async function gravaEnvelope(tx: Tx, escolaId: string, matriculaId: string,
  e: { envelopeId: string; status: string; modo: 'MOCK' | 'DOCUSIGN' },
  signatarios: { papel: string; nome: string; email: string; cpf?: string; ordem: number }[]) {
  const r = await tx.query<{ id: string }>(
    `insert into envelope (escola_id, matricula_id, envelope_id, modo, status) values ($1,$2,$3,$4,$5) returning id`,
    [escolaId, matriculaId, e.envelopeId, e.modo, e.status]);
  const envId = r.rows[0]!.id;
  for (const s of signatarios) {
    await tx.query(
      `insert into envelope_signatario (escola_id, envelope_id, papel, nome, email, cpf, ordem)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [escolaId, envId, s.papel, s.nome, s.email, s.cpf ?? null, s.ordem]);
  }
  await tx.query('insert into envelope_indice (envelope_id, escola_id) values ($1,$2)', [e.envelopeId, escolaId]);
  await tx.query("update matricula set status = 'enviada' where id = $1", [matriculaId]);
  return envId;
}

export async function statusMatricula(tx: Tx, id: string, status: string) {
  await tx.query('update matricula set status = $2 where id = $1', [id, status]);
}
