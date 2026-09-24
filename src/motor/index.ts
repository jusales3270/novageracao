import { CanalImagem, type PedidoMatricula } from '../dominio/tipos.js';
import { calcula, DEGRAUS_MATRICULA, type Calculo } from './calculo.js';
import * as R from './regras.js';
import { buscaLinha, type TabelaPrecos } from './tabela-precos.js';

export * from './tabela-precos.js';
export * from './calculo.js';
export * from './regras.js';

export interface Contexto {
  tabela: TabelaPrecos;
  testemunhas: { nome: string; cpf: string }[];
  dpaAssinado: boolean;
  ambiente: 'sandbox' | 'homologacao' | 'producao';
}

export interface VereditoFinal {
  decisao: 'LIBERADO' | 'BLOQUEADO';
  calculo: Calculo | null;
  vereditos: R.Veredito[];
  bloqueios: R.Veredito[];
  alertas: R.Veredito[];
  /** Hash determinístico da entrada + veredito, para o ledger. */
  assinaturaLogica: string;
}

const CANAIS_EXIGIDOS = CanalImagem.options;

/**
 * Núcleo Zero-Inference: recebe o pedido, aplica as doze regras e devolve
 * um veredito. Nenhum modelo de linguagem participa desta função. O LLM,
 * quando existir, apenas narra este resultado — nunca o produz.
 *
 * Fail-closed: qualquer regra BLOQUEIA não conforme impede a geração de
 * documento. É por isso que o piloto pode ser entregue com os gaps abertos:
 * ele se recusa a produzir o contrato errado.
 */
export function avalia(pedido: PedidoMatricula, ctx: Contexto): VereditoFinal {
  const { tabela } = ctx;
  const linha = buscaLinha(tabela, pedido.servicos.turma, pedido.servicos.periodo);

  const canaisDecididos = [...new Set(pedido.consentimentos.map((c) => c.canal))];

  const degraus = Object.values(DEGRAUS_MATRICULA).map((d) => ({
    pct: d.pct,
    parcelas: d.parcelas,
    valorDoc: Math.round(((tabela.matriculaCheia * (1 - d.pct / 100)) / d.parcelas) * 100) / 100,
  }));

  const vereditos: R.Veredito[] = [
    R.r07_tabelaAprovada(tabela),
    R.r08_anoCoerente(pedido.anoLetivo, tabela.anoLetivo),
    R.r01_reconciliaAnuidade(linha),
    R.r02_alimentacaoDupla(linha, pedido.servicos.alimentacao),
    R.r03_alcadaDesconto(
      pedido.operador.papel,
      pedido.descontoExcepcionalPct,
      pedido.justificativaDesconto,
    ),
    R.r04_consentimentoGranular(canaisDecididos, CANAIS_EXIGIDOS),
    R.r05_medicacaoComPrescricao(pedido.aluno.ficha, pedido.aluno.ficha.prescricaoAnexada),
    R.r06_testemunhas(ctx.testemunhas.length),
    R.r09_responsavelFinanceiro(
      pedido.contratante.cpf,
      pedido.responsavelFinanceiro.cpf,
      pedido.responsavelFinanceiro.nome,
    ),
    R.r10_restricaoGuarda(pedido.aluno.restricaoJudicial, pedido.aluno.autorizadosRetirada.length),
    R.r11_escadaMatricula(tabela.matriculaCheia, degraus),
    R.r12_dpaAssinado(ctx.dpaAssinado, ctx.ambiente),
  ];

  const bloqueios = vereditos.filter((v) => v.severidade === 'BLOQUEIA' && !v.conforme);
  const alertas = vereditos.filter((v) => v.severidade !== 'BLOQUEIA' && !v.conforme);
  const decisao = bloqueios.length === 0 ? 'LIBERADO' : 'BLOQUEADO';

  return {
    decisao,
    calculo:
      decisao === 'LIBERADO'
        ? calcula(
            tabela,
            pedido.servicos,
            pedido.formaPagamentoMatricula,
            pedido.descontoExcepcionalPct,
          )
        : null,
    vereditos,
    bloqueios,
    alertas,
    assinaturaLogica: assinaLogica(pedido, vereditos),
  };
}

import { createHash } from 'node:crypto';

function assinaLogica(pedido: PedidoMatricula, vs: R.Veredito[]): string {
  const canon = JSON.stringify({
    ano: pedido.anoLetivo,
    turma: pedido.servicos.turma,
    periodo: pedido.servicos.periodo,
    servicos: pedido.servicos,
    desconto: pedido.descontoExcepcionalPct,
    aluno: pedido.aluno.nome,
    vereditos: vs.map((v) => [v.regra, v.conforme]),
  });
  return createHash('sha256').update(canon).digest('hex');
}
