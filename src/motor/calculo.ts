import { cent, type FormaPagamentoMatricula, type ServicosContratados } from '../dominio/tipos.js';
import { anuidadeDerivada, buscaLinha, type TabelaPrecos } from './tabela-precos.js';

/** Degraus da escada de matrícula, conforme o requerimento. */
export const DEGRAUS_MATRICULA: Record<
  FormaPagamentoMatricula,
  { pct: number; parcelas: number; rotulo: string; prazo?: string }
> = {
  AVISTA_ATE_31_08: { pct: 50, parcelas: 1, rotulo: 'Pix/TED/dinheiro até 31/08', prazo: '31/08' },
  AVISTA_ATE_15_09: { pct: 45, parcelas: 1, rotulo: 'Pix/TED/dinheiro até 15/09', prazo: '15/09' },
  AVISTA_1X: { pct: 40, parcelas: 1, rotulo: 'Cartão ou boleto 1×' },
  CARTAO_2X: { pct: 35, parcelas: 2, rotulo: 'Cartão ou boleto 2×' },
  CARTAO_3X: { pct: 20, parcelas: 3, rotulo: 'Cartão ou boleto 3×' },
  CARTAO_4X: { pct: 10, parcelas: 4, rotulo: 'Cartão ou boleto 4×' },
  CARTAO_5X: { pct: 5, parcelas: 5, rotulo: 'Cartão ou boleto 5×' },
  CARTAO_6X: { pct: 0, parcelas: 6, rotulo: 'Cartão ou boleto 6×' },
};

export interface ComposicaoMensal {
  servicoEducacional: number;
  alimentacao: number;
  fraldario: number;
  horaAdicional: number;
  descontoExcepcional: number;
  totalCheio: number;
  descontoPontualidade: number;
  totalComPontualidade: number;
}

export interface Calculo {
  anuidade: number;
  mensal: ComposicaoMensal;
  matricula: { rotulo: string; pct: number; parcelas: number; valorParcela: number; total: number };
}

export function calcula(
  t: TabelaPrecos,
  s: ServicosContratados,
  forma: FormaPagamentoMatricula,
  descontoExcepcionalPct: number,
): Calculo {
  const linha = buscaLinha(t, s.turma, s.periodo);
  const a = t.adicionais;

  const alimentacao =
    s.alimentacao === 'ALMOCO'
      ? a.almoco
      : s.alimentacao === 'ALMOCO_JANTAR'
        ? a.almocoJantar
        : s.alimentacao === 'ALMOCO_OU_JANTAR'
          ? a.almocoOuJantar
          : 0;

  const fraldario =
    s.fraldario === 'MEIO'
      ? a.fraldarioMeio
      : s.fraldario === 'INTEGRAL'
        ? a.fraldarioIntegral
        : s.fraldario === 'AVULSO'
          ? a.fraldarioAvulso
          : 0;

  const horaAdicional = cent(s.horaAdicionalDiasMes * a.horaAdicional);
  const descontoExcepcional = cent(linha.mensalidade * (descontoExcepcionalPct / 100));
  const totalCheio = cent(
    linha.mensalidade + alimentacao + fraldario + horaAdicional - descontoExcepcional,
  );

  // Cl. 8ª §6º — pontualidade incide só sobre a anuidade, não sobre
  // serviços e produtos cobrados separadamente.
  const baseP = cent(linha.mensalidade - descontoExcepcional);
  const descontoPontualidade = cent(baseP * (t.descontoPontualidadePct / 100));

  const d = DEGRAUS_MATRICULA[forma];
  const totalMatricula = cent(t.matriculaCheia * (1 - d.pct / 100));

  return {
    anuidade: anuidadeDerivada(linha),
    mensal: {
      servicoEducacional: linha.mensalidade,
      alimentacao,
      fraldario,
      horaAdicional,
      descontoExcepcional,
      totalCheio,
      descontoPontualidade,
      totalComPontualidade: cent(totalCheio - descontoPontualidade),
    },
    matricula: {
      rotulo: d.rotulo,
      pct: d.pct,
      parcelas: d.parcelas,
      valorParcela: cent(totalMatricula / d.parcelas),
      total: totalMatricula,
    },
  };
}
