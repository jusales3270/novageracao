import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PedidoMatricula, validaCPF, cent } from '../src/dominio/tipos.js';
import {
  avalia,
  anuidadeDerivada,
  calcula,
  DEGRAUS_MATRICULA,
  r01_reconciliaAnuidade,
  TABELA_2027,
  type Contexto,
} from '../src/motor/index.js';
import { RegistroConsentimento } from '../src/consentimento/modelo.js';
import { montaDefinicao } from '../src/assinatura/envelope.js';
import { PEDIDO_BERCARIO, PEDIDO_DESCONTO, PEDIDO_OK } from '../fixtures/pedidos.js';

const TABELA_APROVADA = { ...TABELA_2027, aprovadaPor: 'Marlene Modesto da Silva' };

const ctx = (o: Partial<Contexto> = {}): Contexto => ({
  tabela: TABELA_APROVADA,
  testemunhas: [
    { nome: 'Vanessa Prado', cpf: '52998224725' },
    { nome: 'Juliana Retz', cpf: '15350946056' },
  ],
  dpaAssinado: false,
  ambiente: 'homologacao',
  ...o,
});

/* ---------------------------------------------------------------- *
 * Fixtures congeladas: os seis pares mensalidade/anuidade extraídos
 * do requerimento e da Cláusula 8ª. Se alguém mexer na tabela sem
 * decisão da direção, o CI quebra aqui.
 * ---------------------------------------------------------------- */
describe('R-01 — reconciliação de anuidade (fixtures congeladas)', () => {
  const ESPERADO: [string, string, number, boolean][] = [
    ['BERCARIO', 'MEIO', 26227.44, true],
    ['BERCARIO', 'INTEGRAL', 44327.28, false],
    ['MINI_MATERNAL', 'MEIO', 24147.0, true],
    ['MINI_MATERNAL', 'INTEGRAL', 36057.48, true],
    ['MATERNAL_JARDIM_ALFA', 'MEIO', 24961.56, true],
    ['MATERNAL_JARDIM_ALFA', 'INTEGRAL', 36872.16, true],
  ];

  for (const [faixa, periodo, anuidade, conforme] of ESPERADO) {
    test(`${faixa}/${periodo}`, () => {
      const l = TABELA_2027.linhas.find((x) => x.faixa === faixa && x.periodo === periodo)!;
      assert.equal(anuidadeDerivada(l), anuidade);
      assert.equal(r01_reconciliaAnuidade(l).conforme, conforme);
    });
  }

  test('a divergência do berçário integral é exatamente 1729.05', () => {
    const l = TABELA_2027.linhas.find((x) => x.faixa === 'BERCARIO' && x.periodo === 'INTEGRAL')!;
    assert.equal(cent(l.anuidadeDeclaradaContrato - anuidadeDerivada(l)), 1729.05);
  });
});

describe('R-11 — escada de matrícula', () => {
  test('os sete degraus fecham contra a matrícula cheia', () => {
    const esperado: Record<string, number> = {
      AVISTA_ATE_31_08: 910.73,
      AVISTA_ATE_15_09: 1001.8,
      AVISTA_1X: 1092.88,
      CARTAO_2X: 591.97,
      CARTAO_3X: 485.72,
      CARTAO_4X: 409.83,
      CARTAO_5X: 346.08,
      CARTAO_6X: 303.58,
    };
    for (const [forma, valor] of Object.entries(esperado)) {
      const c = calcula(TABELA_APROVADA, PEDIDO_OK.servicos, forma as never, 0);
      assert.ok(
        Math.abs(c.matricula.valorParcela - valor) <= 0.01,
        `${forma}: ${c.matricula.valorParcela} × ${valor}`,
      );
    }
  });

  test('o degrau de 50% corresponde ao valor impresso no requerimento', () => {
    assert.equal(DEGRAUS_MATRICULA.AVISTA_ATE_31_08.pct, 50);
    assert.equal(cent(TABELA_2027.matriculaCheia * 0.5), 910.73);
  });
});

describe('Fail-closed', () => {
  test('caso feliz libera com as 12 regras conformes', () => {
    const v = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx());
    assert.equal(v.decisao, 'LIBERADO');
    assert.equal(v.bloqueios.length, 0);
    assert.equal(v.vereditos.length, 12);
    assert.ok(v.calculo);
  });

  test('berçário integral bloqueia por A-01 e A-02', () => {
    const v = avalia(PedidoMatricula.parse(PEDIDO_BERCARIO), ctx());
    assert.equal(v.decisao, 'BLOQUEADO');
    assert.equal(v.calculo, null);
    const regras = v.bloqueios.map((b) => b.regra).sort();
    assert.deepEqual(regras, ['R-01', 'R-02']);
  });

  test('desconto de 18% pela secretaria bloqueia por alçada', () => {
    const v = avalia(PedidoMatricula.parse(PEDIDO_DESCONTO), ctx());
    assert.equal(v.decisao, 'BLOQUEADO');
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-03'));
  });

  test('o mesmo desconto passa quando quem concede é a direção', () => {
    const p = PedidoMatricula.parse({
      ...PEDIDO_DESCONTO,
      operador: { nome: 'Marlene Modesto da Silva', papel: 'DIRECAO' },
    });
    assert.equal(avalia(p, ctx()).decisao, 'LIBERADO');
  });

  test('tabela sem aprovação bloqueia tudo', () => {
    const v = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx({ tabela: TABELA_2027 }));
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-07'));
  });

  test('uma testemunha só bloqueia (título executivo)', () => {
    const v = avalia(
      PedidoMatricula.parse(PEDIDO_OK),
      ctx({ testemunhas: [{ nome: 'Vanessa Prado', cpf: '52998224725' }] }),
    );
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-06'));
  });

  test('antitérmico autorizado sem prescrição bloqueia', () => {
    const v = avalia(PedidoMatricula.parse({
      ...PEDIDO_OK, aluno: { ...PEDIDO_OK.aluno, ficha: { ...PEDIDO_OK.aluno.ficha, prescricaoAnexada: false } },
    }), ctx());
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-05'));
  });

  test('produção sem DPA assinado bloqueia', () => {
    const v = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx({ ambiente: 'producao' }));
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-12'));
  });

  test('consentimento incompleto bloqueia (Cl. 16ª)', () => {
    const v = avalia(
      PedidoMatricula.parse({
        ...PEDIDO_OK,
        consentimentos: PEDIDO_OK.consentimentos.slice(0, 2),
      }),
      ctx(),
    );
    assert.ok(v.bloqueios.some((b) => b.regra === 'R-04'));
  });
});

describe('Determinismo', () => {
  test('mesma entrada produz a mesma assinatura lógica', () => {
    const a = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx());
    const b = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx());
    assert.equal(a.assinaturaLogica, b.assinaturaLogica);
  });

  test('mudar o serviço muda a assinatura lógica', () => {
    const a = avalia(PedidoMatricula.parse(PEDIDO_OK), ctx());
    const b = avalia(
      PedidoMatricula.parse({
        ...PEDIDO_OK,
        servicos: { ...PEDIDO_OK.servicos, periodo: 'MEIO' },
      }),
      ctx(),
    );
    assert.notEqual(a.assinaturaLogica, b.assinaturaLogica);
  });
});

describe('Consentimento revogável', () => {
  const reg = new RegistroConsentimento('MAT-TESTE');
  const base = {
    porCpf: '39053344705',
    porNome: 'Rodrigo Fontoura Alves',
    canalColeta: 'REQUERIMENTO' as const,
  };

  test('sem evento a resposta é não (fail-closed)', () => {
    assert.equal(reg.podePublicar('SITE'), false);
  });

  test('concessão e revogação respeitam a linha do tempo', () => {
    reg.registrar({ ...base, canal: 'SITE', concedido: true, em: '2026-02-01T10:00:00.000Z' });
    reg.registrar({ ...base, canal: 'SITE', concedido: false, em: '2026-06-15T10:00:00.000Z' });

    assert.equal(reg.podePublicar('SITE', '2026-01-01T00:00:00.000Z'), false);
    assert.equal(reg.podePublicar('SITE', '2026-03-01T00:00:00.000Z'), true);
    assert.equal(reg.podePublicar('SITE', '2026-07-01T00:00:00.000Z'), false);
  });
});

describe('Envelope Docusign', () => {
  const def = montaDefinicao({
    matriculaId: 'MAT-2027-TESTE',
    alunoNome: 'Helena Braga Fontoura',
    anoLetivo: 2027,
    documentos: [{ id: '1', nome: 'contrato.pdf', base64: 'AAAA' }],
    signatarios: [
      { nome: 'Rodrigo', email: 'r@x.com', cpf: '39053344705', papel: 'CONTRATANTE', ordem: 1 },
      { nome: 'Carolina', email: 'c@x.com', cpf: '11144477735', papel: 'RESPONSAVEL_FINANCEIRO', ordem: 2 },
      { nome: 'CNG', email: 'e@x.com', papel: 'ESCOLA', ordem: 3 },
      { nome: 'Vanessa', email: 'v@x.com', cpf: '52998224725', papel: 'TESTEMUNHA', ordem: 4 },
      { nome: 'Juliana', email: 'j@x.com', cpf: '15350946056', papel: 'TESTEMUNHA', ordem: 4 },
    ],
    webhookUrl: 'https://exemplo/ds/webhook',
  });

  test('cinco signatários com recipientId único', () => {
    const ids = def.recipients.signers.map((s) => s.recipientId);
    assert.equal(ids.length, 5);
    assert.equal(new Set(ids).size, 5);
  });

  test('testemunhas em roteamento paralelo, depois da escola', () => {
    const t = def.recipients.signers.filter((s) => s.roleName === 'TESTEMUNHA');
    assert.equal(t.length, 2);
    assert.deepEqual([...new Set(t.map((s) => s.routingOrder))], ['4']);
    const escola = def.recipients.signers.find((s) => s.roleName === 'ESCOLA')!;
    assert.ok(Number(escola.routingOrder) < Number(t[0]!.routingOrder));
  });

  test('cada signatário recebe âncora de assinatura', () => {
    for (const s of def.recipients.signers) {
      assert.ok(s.tabs.signHereTabs[0]!.anchorString.startsWith('/ass_'));
    }
  });

  test('envelope declara webhook com os eventos de conclusão', () => {
    const ev = (def as { eventNotification?: { envelopeEvents: { envelopeEventStatusCode: string }[] } })
      .eventNotification;
    assert.ok(ev);
    assert.ok(ev.envelopeEvents.some((e) => e.envelopeEventStatusCode === 'completed'));
  });

  test('matriculaId viaja em custom field para o webhook conciliar', () => {
    const f = def.customFields.textCustomFields.find((x) => x.name === 'matriculaId');
    assert.equal(f?.value, 'MAT-2027-TESTE');
  });
});

describe('Validação de CPF', () => {
  test('aceita válidos e recusa inválidos', () => {
    assert.equal(validaCPF('390.533.447-05'), true);
    assert.equal(validaCPF('111.444.777-35'), true);
    assert.equal(validaCPF('111.111.111-11'), false);
    assert.equal(validaCPF('123.456.789-00'), false);
  });
});
