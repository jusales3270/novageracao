import { brl, cent, PedidoMatricula } from './dominio/tipos.js';
import {
  anuidadeDerivada,
  avalia,
  r01_reconciliaAnuidade,
  TABELA_2027,
  type Contexto,
} from './motor/index.js';
import { PARCELAS_ANUIDADE } from './motor/tabela-precos.js';
import { PEDIDO_BERCARIO, PEDIDO_DESCONTO, PEDIDO_OK } from '../fixtures/pedidos.js';

const c = {
  ok: (s: string) => `\x1b[32m${s}\x1b[0m`,
  err: (s: string) => `\x1b[31m${s}\x1b[0m`,
  warn: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  b: (s: string) => `\x1b[1m${s}\x1b[0m`,
};


function contexto(over: Partial<Contexto> = {}): Contexto {
  return {
    tabela: TABELA_2027,
    testemunhas: [
      { nome: 'Vanessa Prado', cpf: '52998224725' },
      { nome: 'Juliana Retz', cpf: '15350946056' },
    ],
    dpaAssinado: false,
    ambiente: 'homologacao',
    ...over,
  };
}

function titulo(t: string) {
  console.log(`\n${c.b(t)}\n${'─'.repeat(t.length)}`);
}

function imprimeVereditos(vs: { regra: string; titulo: string; conforme: boolean; severidade: string; detalhe: string; achado?: string; dono?: string }[]) {
  for (const v of vs) {
    const marca = v.conforme ? c.ok('  S ') : v.severidade === 'BLOQUEIA' ? c.err('  N ') : c.warn(' ED ');
    const ref = v.achado ? c.dim(` [${v.achado}]`) : '';
    console.log(`${marca} ${v.regra}  ${v.titulo}${ref}`);
    if (!v.conforme) console.log(`      ${c.dim(v.detalhe)}${v.dono ? c.dim(`  → ${v.dono}`) : ''}`);
  }
}

/* ------------------------------ comandos ------------------------------ */

function cmdReconciliar() {
  titulo('Reconciliação da tabela de preços 2027');
  console.log(
    c.dim('Turma / período').padEnd(46) +
      c.dim('mensal×12'.padStart(14)) +
      c.dim('contrato'.padStart(14)) +
      c.dim('Δ'.padStart(12)),
  );
  for (const l of TABELA_2027.linhas) {
    const v = r01_reconciliaAnuidade(l);
    const der = anuidadeDerivada(l);
    const delta = cent(l.anuidadeDeclaradaContrato - der);
    const linha =
      `${l.faixa}/${l.periodo}`.padEnd(46) +
      der.toFixed(2).padStart(14) +
      l.anuidadeDeclaradaContrato.toFixed(2).padStart(14) +
      delta.toFixed(2).padStart(12);
    console.log(v.conforme ? linha : c.err(linha));
    if (!v.conforme) {
      console.log(
        c.dim(
          `${' '.repeat(46)}mensalidade implícita no contrato: ${cent(l.anuidadeDeclaradaContrato / PARCELAS_ANUIDADE).toFixed(2)} × requerimento: ${l.mensalidade.toFixed(2)}`,
        ),
      );
    }
  }
}

function cmdGaps() {
  titulo('Gaps abertos — bloqueiam geração de documento');
  const ctx = contexto({ tabela: { ...TABELA_2027, aprovadaPor: 'Marlene Modesto da Silva' } });
  const p = (x: unknown) => PedidoMatricula.parse(x);
  const casos: [string, ReturnType<typeof avalia>][] = [
    ['Alfa I integral (caso feliz)', avalia(p(PEDIDO_OK), ctx)],
    ['Berçário integral', avalia(p(PEDIDO_BERCARIO), ctx)],
    ['Desconto de 18% pela secretaria', avalia(p(PEDIDO_DESCONTO), ctx)],
  ];
  for (const [nome, v] of casos) {
    console.log(`\n${c.b(nome)} → ${v.decisao === 'LIBERADO' ? c.ok(v.decisao) : c.err(v.decisao)}`);
    imprimeVereditos(v.vereditos.filter((x) => !x.conforme));
    if (v.decisao === 'LIBERADO') console.log(c.ok('  Todas as 12 regras conformes.'));
  }
}

/* -------------------------------- main -------------------------------- */

const cmd = process.argv[2] ?? 'gaps';
const rotas: Record<string, () => void | Promise<void>> = {
  reconciliar: cmdReconciliar,
  gaps: cmdGaps,
};
const fn = rotas[cmd];
if (!fn) {
  console.error(`Comando desconhecido: ${cmd}. Use: ${Object.keys(rotas).join(' | ')}`);
  process.exit(2);
}
await fn();
