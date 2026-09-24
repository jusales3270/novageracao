import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

/** A interface de produção, no navegador, contra o servidor real. */

const PORTA = 4800 + Math.floor(Math.random() * 400);
const B = `http://127.0.0.1:${PORTA}`;
let srv: ChildProcess, nav: Browser, pg: Page;

const veredito = () => pg.innerText('#decisao').then((t) => t.split('\n')[0]!.trim());

/**
 * Espera o painel refletir ESTE pedido, não o anterior.
 * Esperar só por "BLOQUEADO" casa com o bloqueio que já estava na tela —
 * por isso a espera é pelo texto que só este caso produz.
 */
const esperaPainel = (trecho: string) =>
  pg.waitForFunction(
    (t) => (document.getElementById('decisao')!.textContent + document.getElementById('motivo')!.textContent + document.getElementById('preco')!.textContent).includes(t),
    trecho, { timeout: 20000 });

before(async () => {
  const { NODE_TEST_CONTEXT: _a, NODE_OPTIONS: _b, ...amb } = process.env;
  srv = spawn('node', ['--import', 'tsx', 'src/api/server.ts'], {
    env: { ...amb, PORTA: String(PORTA), COOKIE_SEGURO: 'false', DS_MODO: 'mock',
           AMBIENTE: 'homologacao', ARQUIVOS_DIR: '/tmp/ng-arquivos-ui' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${B}/saude`)).ok) break; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  nav = await chromium.launch({ args: ['--no-sandbox'] });
  pg = await nav.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', (e) => { throw new Error('erro de JS na página: ' + e.message); });
});
after(async () => { await nav?.close(); srv?.kill('SIGTERM'); });

describe('Interface de produção', () => {
  test('raiz sem sessão leva ao login', async () => {
    await pg.goto(`${B}/`);
    assert.match(pg.url(), /\/login$/);
  });

  test('login entra no sistema e mostra quem está operando', async () => {
    await pg.fill('#email', 'secretaria@novageracaoitu.com.br');
    await pg.fill('#senha', 'secretaria-dev-2027');
    await pg.click('#b');
    await pg.waitForURL(`${B}/`);
    await pg.waitForSelector('#quemNome:not(:empty)');
    assert.equal(await pg.innerText('#quemNome'), 'Vanessa Prado');
    assert.equal(await pg.inputValue('#opPapel'), 'secretaria');
  });

  test('o perfil não é editável pela tela', async () => {
    assert.equal(await pg.getAttribute('#opPapel', 'disabled'), '');
    assert.equal(await pg.getAttribute('#opNome', 'disabled'), '');
  });

  test('formulário vazio mostra o que falta preencher', async () => {
    await pg.waitForFunction(() => document.getElementById('decisao')?.textContent?.includes('INCOMPLETO'));
    assert.equal(await veredito(), 'INCOMPLETO');
    assert.ok((await pg.innerText('#motivo')).includes('Nome do aluno'));
  });

  test('exemplo preenchido → LIBERADO com os valores do servidor', async () => {
    await pg.click('#btnExemplo');
    await esperaPainel('3.642,68');
    const preco = await pg.innerText('#preco');
    assert.ok(preco.includes('3.642,68'), preco);
    assert.ok(preco.includes('36.872,16'), preco);
    assert.equal(await pg.isDisabled('#btnEmitir'), false);
  });

  test('berçário integral com almoço e jantar bloqueia e desabilita a emissão', async () => {
    await pg.selectOption('#turma', 'BERCARIO');
    await pg.selectOption('#periodo', 'INTEGRAL');
    await pg.selectOption('#alimentacao', 'ALMOCO_JANTAR');
    await esperaPainel('1729.05');
    const motivo = await pg.innerText('#motivo');
    assert.ok(motivo.includes('1729.05'), motivo);
    assert.equal(await pg.isDisabled('#btnEmitir'), true);
  });

  test('desconto de 18% pela secretaria bloqueia por alçada', async () => {
    await pg.selectOption('#turma', 'ALFA_I');
    await pg.selectOption('#alimentacao', 'ALMOCO');
    await pg.fill('#descPct', '18');
    await pg.fill('#descJust', 'Segundo irmão');
    await esperaPainel('Solicitado 18%');
    assert.equal(await veredito(), 'BLOQUEADO');
    await pg.fill('#descPct', '0');
    await esperaPainel('3.642,68');
    assert.equal(await veredito(), 'LIBERADO');
  });

  test('emitir gera os PDFs, o envelope e a trilha na tela', async () => {
    await pg.click('#btnEmitir');
    await pg.waitForSelector('#resultado:not(.oculto)', { timeout: 60000 });
    assert.match(await pg.innerText('#resId'), /MAT-2027-/);
    assert.equal(await pg.locator('#resDocs .doc').count(), 2);
    // no exemplo da tela o responsável financeiro é o próprio contratante:
    // contratante + escola + duas testemunhas
    assert.equal(await pg.locator('#resAss .assinante').count(), 4);
    assert.ok(!(await pg.innerText('#resAss')).includes('RESPONSAVEL_FINANCEIRO'));
    const trilha = await pg.innerText('#resTrilha');
    assert.ok(trilha.includes('ÍNTEGRA'), trilha);
    assert.ok(trilha.includes('ENVELOPE_ENVIADO'), trilha);
  });

  test('o link do PDF abre um PDF de verdade', async () => {
    const href = await pg.getAttribute('#resDocs a.abrir', 'href');
    const r = await pg.request.get(`${B}${href}`);
    assert.equal(r.status(), 200);
    assert.equal(r.headers()['content-type'], 'application/pdf');
    assert.equal((await r.body()).subarray(0, 4).toString(), '%PDF');
  });

  test('responsável financeiro distinto entra como quinto signatário', async () => {
    await pg.uncheck('#mesmoFin');
    await pg.fill('#fiNome', 'Carolina Braga Fontoura');
    await pg.fill('#fiCpf', '111.444.777-35');
    await pg.fill('#fiEmail', 'carolina@exemplo.com.br');
    await pg.fill('#fiFone', '11988112233');
    await esperaPainel('3.642,68');
    await pg.click('#btnEmitir');
    await pg.waitForFunction(() => document.querySelectorAll('#resAss .assinante').length === 5, null, { timeout: 60000 });
    assert.ok((await pg.innerText('#resAss')).includes('RESPONSAVEL_FINANCEIRO'));
  });

  test('sair encerra a sessão e volta ao login', async () => {
    await pg.click('#btnSair');
    await pg.waitForURL(/\/login$/);
    await pg.goto(`${B}/`);
    assert.match(pg.url(), /\/login$/);
  });
});
