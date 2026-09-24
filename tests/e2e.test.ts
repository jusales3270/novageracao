import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { PEDIDO_OK, PEDIDO_BERCARIO, PEDIDO_DESCONTO } from '../fixtures/pedidos.js';

/**
 * Integração de ponta a ponta: sobe o servidor de verdade, conectado ao Postgres
 * como ng_app (sujeito a RLS), e tenta quebrá-lo.
 *
 * Requer: DATABASE_URL (ng_app), banco migrado e com o setup de teste aplicado.
 */

// porta aleatória alta: evita colidir com servidor deixado para trás por execução anterior
const PORTA = 4200 + Math.floor(Math.random() * 600);
const B = `http://127.0.0.1:${PORTA}`;
const HMAC = 'segredo-connect-teste';
let srv: ChildProcess;

const sessoes: Record<string, string> = {};
const J = { 'Content-Type': 'application/json' };

async function login(email: string, senha: string) {
  const r = await fetch(`${B}/api/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, senha }) });
  const c = r.headers.get('set-cookie') ?? '';
  return { r, cookie: c.split(';')[0] ?? '', bruto: c };
}
const com = (quem: string, extra: Record<string, string> = {}) => ({ Cookie: sessoes[quem]!, ...extra });
const post = (quem: string, caminho: string, corpo: unknown) =>
  fetch(`${B}${caminho}`, { method: 'POST', headers: com(quem, J), body: JSON.stringify(corpo) });

before(async () => {
  // o filho não pode herdar o contexto do executor de testes, senão vira "processo de teste"
  const { NODE_TEST_CONTEXT: _a, NODE_OPTIONS: _b, ...amb } = process.env;
  srv = spawn('node', ['--import', 'tsx', 'src/api/server.ts'], {
    env: { ...amb, PORTA: String(PORTA), COOKIE_SEGURO: 'false', DS_MODO: 'mock',
           AMBIENTE: 'homologacao', DS_CONNECT_HMAC: HMAC, ARQUIVOS_DIR: '/tmp/ng-arquivos-teste' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  srv.stdout!.on('data', (d) => { saida += d; });
  srv.stderr!.on('data', (d) => { saida += d; });
  srv.on('exit', (c) => { if (c !== 0 && c !== null) saida += `\n[servidor saiu com código ${c}]`; });
  let noAr = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${B}/saude`)).ok) { noAr = true; break; } } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!noAr) throw new Error(`servidor não subiu na porta ${PORTA}. Saída:\n${saida}`);
  sessoes.sec = (await login('secretaria@novageracaoitu.com.br', 'secretaria-dev-2027')).cookie;
  sessoes.dir = (await login('direcao@novageracaoitu.com.br', 'direcao-dev-2027!')).cookie;
  sessoes.outra = (await login('intrusa@outra.com', 'intrusa-dev-2027')).cookie;
});
after(() => { srv?.kill('SIGTERM'); });

/* ============================== autenticação ============================== */
describe('Autenticação e superfície', () => {
  test('API sem sessão → 401', async () => {
    assert.equal((await fetch(`${B}/api/simular`, { method: 'POST', headers: J, body: '{}' })).status, 401);
  });
  test('página sem sessão → redireciona para /login', async () => {
    const r = await fetch(`${B}/`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login');
  });
  test('senha errada → 401 com mensagem genérica', async () => {
    const { r } = await login('secretaria@novageracaoitu.com.br', 'errada');
    assert.equal(r.status, 401);
    assert.equal((await r.json()).erro, 'E-mail ou senha inválidos.');
  });
  test('e-mail inexistente → mesma mensagem (não revela quais e-mails existem)', async () => {
    const { r } = await login('ninguem@x.com', 'qualquer-coisa');
    assert.equal((await r.json()).erro, 'E-mail ou senha inválidos.');
  });
  test('cookie de sessão é HttpOnly e SameSite=Strict', async () => {
    const { bruto } = await login('secretaria@novageracaoitu.com.br', 'secretaria-dev-2027');
    assert.match(bruto, /HttpOnly/);
    assert.match(bruto, /SameSite=Strict/);
  });
  test('mutação sem JSON é recusada (CSRF) → 415', async () => {
    const r = await fetch(`${B}/api/simular`, { method: 'POST',
      headers: com('sec', { 'Content-Type': 'application/x-www-form-urlencoded' }), body: 'a=1' });
    assert.equal(r.status, 415);
  });
  test('corpo acima de 1 MB → 413', async () => {
    const r = await fetch(`${B}/api/simular`, { method: 'POST', headers: com('sec', J), body: 'a'.repeat(1_100_000) });
    assert.equal(r.status, 413);
  });
  test('cabeçalhos de segurança presentes', async () => {
    const r = await fetch(`${B}/login`);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  });
});

/* ================================= motor ================================= */
describe('Motor no servidor', () => {
  test('pedido incompleto → INCOMPLETO com pendências legíveis', async () => {
    const r = await (await post('sec', '/api/simular', { anoLetivo: 2027 })).json();
    assert.equal(r.decisao, 'INCOMPLETO');
    assert.ok(Array.isArray(r.pendencias) && r.pendencias.length > 0);
  });
  test('caso feliz → LIBERADO com cálculo do servidor', async () => {
    const r = await (await post('sec', '/api/simular', PEDIDO_OK)).json();
    assert.equal(r.decisao, 'LIBERADO');
    assert.equal(r.calculo.mensal.totalCheio, 3642.68);
    assert.equal(r.calculo.anuidade, 36872.16);
  });
  test('ATAQUE: secretaria envia perfil DIRECAO no corpo → servidor ignora e bloqueia 18%', async () => {
    const forjado = { ...PEDIDO_DESCONTO, operador: { nome: 'Marlene', papel: 'DIRECAO' } };
    const r = await (await post('sec', '/api/simular', forjado)).json();
    assert.equal(r.decisao, 'BLOQUEADO');
    assert.ok(r.bloqueios.some((b: { regra: string }) => b.regra === 'R-03'));
  });
  test('o mesmo desconto passa quando a sessão é da direção', async () => {
    const r = await (await post('dir', '/api/simular', PEDIDO_DESCONTO)).json();
    assert.equal(r.decisao, 'LIBERADO');
  });
  test('berçário integral + almoço e jantar → bloqueia por R-01 e R-02', async () => {
    const r = await (await post('sec', '/api/simular', PEDIDO_BERCARIO)).json();
    assert.equal(r.decisao, 'BLOQUEADO');
    assert.deepEqual(r.bloqueios.map((b: { regra: string }) => b.regra).sort(), ['R-01', 'R-02']);
  });
});

/* =============================== emissão =============================== */
let emitida: { matriculaId: string; documentos: { id: string; sha256: string }[]; envelope: { id: string } };

describe('Emissão e documentos', () => {
  test('emitir → 201, dois PDFs, envelope com 5 signatários', async () => {
    const r = await post('sec', '/api/emitir', PEDIDO_OK);
    assert.equal(r.status, 201);
    emitida = await r.json();
    assert.match(emitida.matriculaId, /^MAT-2027-/);
    assert.equal(emitida.documentos.length, 2);
    const e = emitida as unknown as { signatarios: { papel: string }[]; envelope: { modo: string } };
    assert.equal(e.envelope.modo, 'MOCK');
    // no fixture a mãe é a responsável financeira, então ela entra como signatária própria
    assert.deepEqual(e.signatarios.map((s) => s.papel),
      ['CONTRATANTE', 'RESPONSAVEL_FINANCEIRO', 'ESCOLA', 'TESTEMUNHA', 'TESTEMUNHA']);
  });
  test('emissão bloqueada → 422 e fica registrada como recusada', async () => {
    const r = await post('sec', '/api/emitir', PEDIDO_BERCARIO);
    assert.equal(r.status, 422);
    const j = await r.json();
    assert.equal(j.decisao, 'BLOQUEADO');
    assert.match(j.matriculaId, /^MAT-2027-/);   // a recusa também é evidência
  });
  test('PDF abre com sessão e o SHA-256 confere com o que foi registrado', async () => {
    const d = emitida.documentos[0]!;
    const r = await fetch(`${B}/api/documentos/${d.id}`, { headers: com('sec') });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString(), '%PDF');
    assert.equal(createHash('sha256').update(buf).digest('hex'), d.sha256);
  });
  test('PDF sem sessão → 401', async () => {
    assert.equal((await fetch(`${B}/api/documentos/${emitida.documentos[0]!.id}`)).status, 401);
  });
  test('ATAQUE: usuária de outra escola pede o PDF pelo id → 404 (RLS: não existe para ela)', async () => {
    const r = await fetch(`${B}/api/documentos/${emitida.documentos[0]!.id}`, { headers: com('outra') });
    assert.equal(r.status, 404);
  });
  test('ATAQUE: outra escola pede a trilha → vê zero eventos', async () => {
    const r = await (await fetch(`${B}/api/matriculas/${emitida.matriculaId}/trilha`, { headers: com('outra') })).json();
    assert.equal(r.eventos.length, 0);
  });
  test('trilha da matrícula íntegra e completa', async () => {
    const r = await (await fetch(`${B}/api/matriculas/${emitida.matriculaId}/trilha`, { headers: com('sec') })).json();
    assert.equal(r.integridade.integra, true);
    const tipos = r.eventos.map((e: { tipo: string }) => e.tipo);
    for (const t of ['PEDIDO_RECEBIDO', 'VEREDITO_MOTOR', 'DOCUMENTO_GERADO', 'ENVELOPE_ENVIADO']) assert.ok(tipos.includes(t), t);
  });
});

/* ============================ Docusign Connect ============================ */
describe('Webhook Docusign Connect', () => {
  const evento = (event: string, extra = {}) => JSON.stringify({
    event, generatedDateTime: '2026-09-23T12:00:00Z',
    data: { envelopeId: emitida.envelope.id, recipientId: '1', envelopeSummary: { status: 'completed',
      recipients: { signers: [{ recipientId: '1', name: PEDIDO_OK.contratante.nome, status: 'completed' }] } }, ...extra },
  });
  const assina = (c: string) => createHmac('sha256', HMAC).update(c).digest('base64');
  const envia = (c: string, sig: string) => fetch(`${B}/ds/webhook`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-DocuSign-Signature-1': sig }, body: c });

  test('ATAQUE: evento sem HMAC válido → 401', async () => {
    assert.equal((await envia(evento('envelope-completed'), 'forjado')).status, 401);
  });
  test('assinatura do contratante registrada', async () => {
    const c = evento('recipient-completed');
    const r = await (await envia(c, assina(c))).json();
    assert.equal(r.processado, 'recipient-completed');
  });
  test('reenvio do mesmo evento é ignorado (idempotência)', async () => {
    const c = evento('recipient-completed');
    const r = await (await envia(c, assina(c))).json();
    assert.equal(r.duplicado, true);
  });
  test('envelope concluído muda a matrícula para concluída', async () => {
    const c = evento('envelope-completed');
    const r = await (await envia(c, assina(c))).json();
    assert.equal(r.processado, 'envelope-completed');
    assert.equal(r.matriculaId, emitida.matriculaId);
  });
});

/* ============================== consentimento ============================== */
describe('Consentimento revogável (Cl. 16ª)', () => {
  test('revogar álbum da turma → deixa de poder publicar agora', async () => {
    const r = await (await post('sec', `/api/matriculas/${emitida.matriculaId}/consentimento/revogar`,
      { canal: 'ALBUM_TURMA', solicitanteNome: PEDIDO_OK.contratante.nome, solicitanteCpf: PEDIDO_OK.contratante.cpf })).json();
    assert.equal(r.podePublicarAgora, false);
  });
});

/* ============================ força bruta ============================ */
describe('Limite de tentativas', () => {
  test('6ª tentativa errada seguida → bloqueio temporário', async () => {
    let ultima = '';
    for (let i = 0; i < 6; i++) ultima = (await (await login('direcao@novageracaoitu.com.br', `errada-${i}`)).r.json()).erro;
    assert.match(ultima, /Muitas tentativas/);
  });
});
