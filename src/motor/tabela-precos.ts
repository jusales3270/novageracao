import { cent, type Periodo, type Turma, FAIXA_PRECO } from '../dominio/tipos.js';

/**
 * FONTE ÚNICA DE PREÇO.
 *
 * A anuidade NÃO é digitada. Ela é derivada da mensalidade × parcelas.
 * Foi a existência de duas fontes independentes — mensalidade no requerimento
 * e anuidade na Cláusula 8ª do contrato — que produziu a divergência de
 * R$ 1.729,05 no Berçário Integral (achado A-01).
 *
 * `anuidadeDeclaradaContrato` existe apenas para reconciliação contra o
 * documento legado. Nunca é usada para calcular nada.
 */

export const PARCELAS_ANUIDADE = 12;

export interface LinhaPreco {
  faixa: string;
  periodo: Periodo;
  mensalidade: number;
  anuidadeDeclaradaContrato: number;
  /** Cl. 3ª: berçário integral descreve almoço, jantar e banho no preço. */
  alimentacaoInclusa: boolean;
  descricaoContrato: string;
}

export interface TabelaPrecos {
  anoLetivo: number;
  vigenciaInicio: string;
  aprovadaPor: string | null;
  descontoPontualidadePct: number;
  matriculaCheia: number;
  adicionais: {
    horaAdicional: number;
    almoco: number;
    almocoJantar: number;
    almocoOuJantar: number;
    fraldarioMeio: number;
    fraldarioIntegral: number;
    fraldarioAvulso: number;
  };
  linhas: LinhaPreco[];
}

export const TABELA_2027: TabelaPrecos = {
  anoLetivo: 2027,
  vigenciaInicio: '2026-08-01',
  aprovadaPor: null, // ← bloqueia geração até a direção aprovar (G-03)
  descontoPontualidadePct: 5,
  matriculaCheia: 1821.46,
  adicionais: {
    horaAdicional: 27.0,
    almoco: 570.0,
    almocoJantar: 800.0,
    almocoOuJantar: 530.0,
    fraldarioMeio: 270.0,
    fraldarioIntegral: 485.0,
    fraldarioAvulso: 27.0,
  },
  linhas: [
    {
      faixa: 'BERCARIO',
      periodo: 'MEIO',
      mensalidade: 2185.62,
      anuidadeDeclaradaContrato: 26227.49,
      alimentacaoInclusa: false,
      descricaoContrato: '04 horas diárias: 7h30–11h30 ou 13h00–17h00',
    },
    {
      faixa: 'BERCARIO',
      periodo: 'INTEGRAL',
      mensalidade: 3693.94,
      anuidadeDeclaradaContrato: 46056.33,
      alimentacaoInclusa: true,
      descricaoContrato: 'Até 10h diárias (almoço, jantar e banho)',
    },
    {
      faixa: 'MINI_MATERNAL',
      periodo: 'MEIO',
      mensalidade: 2012.25,
      anuidadeDeclaradaContrato: 24146.94,
      alimentacaoInclusa: false,
      descricaoContrato: '04 horas diárias: 7h30–11h30 ou 13h00–17h00',
    },
    {
      faixa: 'MINI_MATERNAL',
      periodo: 'INTEGRAL',
      mensalidade: 3004.79,
      anuidadeDeclaradaContrato: 36057.5,
      alimentacaoInclusa: false,
      descricaoContrato: 'Até 10h diárias (04h educacional + 06h recreação)',
    },
    {
      faixa: 'MATERNAL_JARDIM_ALFA',
      periodo: 'MEIO',
      mensalidade: 2080.13,
      anuidadeDeclaradaContrato: 24961.61,
      alimentacaoInclusa: false,
      descricaoContrato: '04 horas diárias: 7h30–11h30 ou 13h00–17h00',
    },
    {
      faixa: 'MATERNAL_JARDIM_ALFA',
      periodo: 'INTEGRAL',
      mensalidade: 3072.68,
      anuidadeDeclaradaContrato: 36872.17,
      alimentacaoInclusa: false,
      descricaoContrato: 'Até 10h diárias (04h educacional + 06h recreação)',
    },
  ],
};

export function buscaLinha(t: TabelaPrecos, turma: Turma, periodo: Periodo): LinhaPreco {
  const faixa = FAIXA_PRECO[turma];
  const l = t.linhas.find((x) => x.faixa === faixa && x.periodo === periodo);
  if (!l) throw new Error(`Sem preço para ${turma}/${periodo} na tabela ${t.anoLetivo}`);
  return l;
}

/** Anuidade sempre derivada. Nunca lida do contrato. */
export const anuidadeDerivada = (l: LinhaPreco) => cent(l.mensalidade * PARCELAS_ANUIDADE);
