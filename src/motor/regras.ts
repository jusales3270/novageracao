import { cent } from '../dominio/tipos.js';
import {
  anuidadeDerivada,
  PARCELAS_ANUIDADE,
  type LinhaPreco,
  type TabelaPrecos,
} from './tabela-precos.js';

/**
 * Regras determinísticas. Nenhuma delas consulta modelo de linguagem.
 * Entrada → veredito. Mesma entrada, mesmo veredito, sempre.
 */

export type Severidade = 'BLOQUEIA' | 'ALERTA' | 'INFORMA';

export interface Veredito {
  regra: string;
  titulo: string;
  severidade: Severidade;
  conforme: boolean;
  detalhe: string;
  /** Referência ao achado do diagnóstico SVS/CNG-001. */
  achado?: string;
  /** Quem decide, quando não é conforme. */
  dono?: 'DIRECAO' | 'JURIDICO' | 'COORDENACAO' | 'SECRETARIA';
}

/** Tolerância de arredondamento: um centavo por parcela. */
export const TOLERANCIA = cent(PARCELAS_ANUIDADE * 0.01);

/* ------------------------------------------------------------------ *
 * R-01 — Anuidade derivada × anuidade declarada no contrato legado
 * ------------------------------------------------------------------ */
export function r01_reconciliaAnuidade(l: LinhaPreco): Veredito {
  const derivada = anuidadeDerivada(l);
  const delta = cent(l.anuidadeDeclaradaContrato - derivada);
  const conforme = Math.abs(delta) <= TOLERANCIA;
  return {
    regra: 'R-01',
    titulo: 'Anuidade do contrato reconcilia com mensalidade × 12',
    severidade: 'BLOQUEIA',
    conforme,
    achado: 'A-01',
    dono: 'DIRECAO',
    detalhe: conforme
      ? `${l.faixa}/${l.periodo}: derivada ${derivada.toFixed(2)} ≈ declarada ${l.anuidadeDeclaradaContrato.toFixed(2)} (Δ ${delta.toFixed(2)})`
      : `${l.faixa}/${l.periodo}: derivada ${derivada.toFixed(2)} × declarada ${l.anuidadeDeclaradaContrato.toFixed(2)} — divergência de ${Math.abs(delta).toFixed(2)}. Mensalidade implícita no contrato: ${cent(l.anuidadeDeclaradaContrato / PARCELAS_ANUIDADE).toFixed(2)}.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-02 — Alimentação: inclusa no contrato não pode ser cobrada à parte
 * ------------------------------------------------------------------ */
export function r02_alimentacaoDupla(
  l: LinhaPreco,
  alimentacaoContratada: string,
): Veredito {
  const cobrandoAparte = alimentacaoContratada !== 'NENHUMA';
  const conflito = l.alimentacaoInclusa && cobrandoAparte;
  return {
    regra: 'R-02',
    titulo: 'Alimentação não é cobrada duas vezes',
    severidade: 'BLOQUEIA',
    conforme: !conflito,
    achado: 'A-02',
    dono: 'DIRECAO',
    detalhe: conflito
      ? `${l.faixa}/${l.periodo}: o contrato descreve "${l.descricaoContrato}" (alimentação inclusa), mas o pedido adiciona ${alimentacaoContratada} como serviço avulso. Cobrança em duplicidade.`
      : 'Sem conflito entre alimentação inclusa e serviço adicional.',
  };
}

/* ------------------------------------------------------------------ *
 * R-03 — Alçada de desconto (Cl. 8ª §2º + prática da direção)
 * ------------------------------------------------------------------ */
export const TETO_ALCADA: Record<string, number> = {
  SECRETARIA: 10,
  COORDENACAO: 10,
  DIRECAO: 100,
};

export function r03_alcadaDesconto(papel: string, pct: number, justificativa?: string): Veredito {
  const teto = TETO_ALCADA[papel] ?? 0;
  const dentro = pct <= teto;
  const precisaJustificar = pct > 0 && !justificativa;
  const conforme = dentro && !precisaJustificar;
  return {
    regra: 'R-03',
    titulo: 'Desconto dentro da alçada do operador',
    severidade: 'BLOQUEIA',
    conforme,
    achado: 'A-08',
    dono: 'DIRECAO',
    detalhe: !dentro
      ? `${papel} pode conceder até ${teto}%. Solicitado ${pct}%. Requer aprovação da direção.`
      : precisaJustificar
        ? `Desconto de ${pct}% exige justificativa registrada.`
        : `Desconto de ${pct}% dentro da alçada de ${papel} (teto ${teto}%).`,
  };
}

/* ------------------------------------------------------------------ *
 * R-04 — Consentimento de imagem por canal (Cl. 16ª)
 * ------------------------------------------------------------------ */
export function r04_consentimentoGranular(canaisDecididos: string[], canaisExigidos: string[]): Veredito {
  const faltando = canaisExigidos.filter((c) => !canaisDecididos.includes(c));
  return {
    regra: 'R-04',
    titulo: 'Consentimento de imagem decidido canal a canal',
    severidade: 'BLOQUEIA',
    conforme: faltando.length === 0,
    achado: 'A-04',
    dono: 'JURIDICO',
    detalhe:
      faltando.length === 0
        ? `Todos os ${canaisExigidos.length} canais têm decisão registrada.`
        : `Sem decisão para: ${faltando.join(', ')}. A Cl. 16ª exige autorização específica e destacada por finalidade.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-05 — Medicação autorizada exige prescrição anexada (Cl. 13ª §1º)
 * ------------------------------------------------------------------ */
export function r05_medicacaoComPrescricao(ficha: {
  usoContinuoMedicamento: boolean;
  qualMedicamento?: string;
  antitermicoAutorizado?: string;
}, prescricaoAnexada: boolean): Veredito {
  const exige = ficha.usoContinuoMedicamento || !!ficha.antitermicoAutorizado;
  const conforme = !exige || prescricaoAnexada;
  return {
    regra: 'R-05',
    titulo: 'Medicação autorizada tem prescrição médica anexada',
    severidade: 'BLOQUEIA',
    conforme,
    achado: 'A-05',
    dono: 'SECRETARIA',
    detalhe: conforme
      ? exige
        ? 'Medicação autorizada com prescrição anexada.'
        : 'Sem medicação autorizada.'
      : `Autorização de "${ficha.qualMedicamento ?? ficha.antitermicoAutorizado}" sem prescrição médica. Cl. 13ª §1º exige dose, horário e período.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-06 — Contrato exige 2 testemunhas com CPF (título executivo)
 * ------------------------------------------------------------------ */
export function r06_testemunhas(qtd: number): Veredito {
  return {
    regra: 'R-06',
    titulo: 'Duas testemunhas nomeadas com CPF',
    severidade: 'BLOQUEIA',
    conforme: qtd === 2,
    achado: 'A-06',
    dono: 'DIRECAO',
    detalhe:
      qtd === 2
        ? 'Duas testemunhas definidas — contrato mantém força de título executivo extrajudicial (CPC art. 784, III).'
        : `${qtd} testemunha(s) definida(s). O contrato exige 2; sem elas o instrumento perde eficácia executiva.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-07 — Tabela de preços aprovada como fonte única
 * ------------------------------------------------------------------ */
export function r07_tabelaAprovada(t: TabelaPrecos): Veredito {
  return {
    regra: 'R-07',
    titulo: 'Tabela de preços aprovada pela direção',
    severidade: 'BLOQUEIA',
    conforme: !!t.aprovadaPor,
    dono: 'DIRECAO',
    detalhe: t.aprovadaPor
      ? `Tabela ${t.anoLetivo} aprovada por ${t.aprovadaPor}, vigência ${t.vigenciaInicio}.`
      : `Tabela ${t.anoLetivo} sem aprovação registrada. Nenhum documento é gerado a partir de tabela não aprovada.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-08 — Ano letivo coerente em todo o documento
 * ------------------------------------------------------------------ */
export function r08_anoCoerente(anoPedido: number, anoTabela: number): Veredito {
  const conforme = anoPedido === anoTabela;
  return {
    regra: 'R-08',
    titulo: 'Ano letivo do pedido bate com o da tabela',
    severidade: 'BLOQUEIA',
    conforme,
    achado: 'A-09',
    dono: 'SECRETARIA',
    detalhe: conforme
      ? `Ano letivo ${anoPedido} consistente.`
      : `Pedido para ${anoPedido} usando tabela de ${anoTabela}.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-09 — Responsável financeiro identificado (pode diferir do legal)
 * ------------------------------------------------------------------ */
export function r09_responsavelFinanceiro(cpfContratante: string, cpfFinanceiro: string, nomeFinanceiro: string): Veredito {
  const preenchido = cpfFinanceiro.length === 11 && nomeFinanceiro.length >= 3;
  return {
    regra: 'R-09',
    titulo: 'Responsável financeiro identificado',
    severidade: 'BLOQUEIA',
    conforme: preenchido,
    dono: 'SECRETARIA',
    detalhe: preenchido
      ? cpfContratante === cpfFinanceiro
        ? 'Contratante e responsável financeiro são a mesma pessoa.'
        : 'Responsável financeiro distinto do contratante — cobrança emitida no CPF correto.'
      : 'Responsável financeiro não identificado. Cobrança emitida em nome errado é cobrança frágil.',
  };
}

/* ------------------------------------------------------------------ *
 * R-10 — Restrição judicial de guarda registrada quando informada
 * ------------------------------------------------------------------ */
export function r10_restricaoGuarda(restricao: string | undefined, autorizados: number): Veredito {
  const conforme = autorizados > 0;
  return {
    regra: 'R-10',
    titulo: 'Pessoas autorizadas à retirada registradas',
    severidade: restricao ? 'BLOQUEIA' : 'ALERTA',
    conforme,
    dono: 'SECRETARIA',
    detalhe: restricao
      ? `Restrição judicial informada: "${restricao}". ${autorizados} pessoa(s) autorizada(s) cadastrada(s). Cl. 12ª §1º exige documento comprobatório em anexo.`
      : conforme
        ? `${autorizados} pessoa(s) autorizada(s) além dos responsáveis.`
        : 'Nenhuma pessoa autorizada além dos responsáveis. Confirmar se é intencional.',
  };
}

/* ------------------------------------------------------------------ *
 * R-11 — Escada de descontos da matrícula fecha na aritmética
 * ------------------------------------------------------------------ */
export function r11_escadaMatricula(cheia: number, degraus: { pct: number; parcelas: number; valorDoc: number }[]): Veredito {
  const erros = degraus.filter(
    (d) => Math.abs(cent((cheia * (1 - d.pct / 100)) / d.parcelas) - d.valorDoc) > 0.01,
  );
  return {
    regra: 'R-11',
    titulo: 'Escada de desconto da matrícula é aritmeticamente consistente',
    severidade: 'ALERTA',
    conforme: erros.length === 0,
    achado: 'A-03',
    dono: 'DIRECAO',
    detalhe:
      erros.length === 0
        ? `${degraus.length} degraus conferem contra a matrícula cheia de ${cheia.toFixed(2)}.`
        : `Degraus fora: ${erros.map((e) => `${e.pct}%/${e.parcelas}x`).join(', ')}.`,
  };
}

/* ------------------------------------------------------------------ *
 * R-12 — Contrato de operador LGPD assinado antes de dado real
 * ------------------------------------------------------------------ */
export function r12_dpaAssinado(dpaAssinado: boolean, ambiente: string): Veredito {
  const conforme = dpaAssinado || ambiente !== 'producao';
  return {
    regra: 'R-12',
    titulo: 'Contrato de tratamento de dados assinado',
    severidade: 'BLOQUEIA',
    conforme,
    dono: 'JURIDICO',
    detalhe: conforme
      ? ambiente === 'producao'
        ? 'DPA controlador/operador assinado.'
        : `Ambiente "${ambiente}" — dados fictícios, DPA não exigido.`
      : 'Dado sensível de criança em produção sem contrato de operador assinado (LGPD art. 39).',
  };
}
