import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ZodError, z } from 'zod';
import { CanalImagem } from '../dominio/tipos.js';
import { comEscola, semEscola } from '../db/pool.js';
import * as repo from '../db/repos.js';
import { trilha, verifica } from '../db/ledger.js';
import { le } from '../documentos/armazenamento.js';
import { encerraRender } from '../documentos/render.js';
import { cookieSessao, entrar, lerCookie, sair, usuarioDaSessao, type Usuario } from '../auth/sessao.js';
import { confereSenha, hashSenha } from '../auth/senha.js';
import { emitir, revogar, simular } from '../servico/emissao.js';
import { processa, verificaHmac } from '../assinatura/connect.js';

try { process.loadEnvFile?.(); } catch {}

const PORTA = Number(process.env.PORTA ?? 3000);
const PUBLICO = join(process.cwd(), 'public');
const LIMITE_CORPO = 1_000_000;           // 1 MB: um requerimento tem ~5 KB
const AMBIENTE = process.env.AMBIENTE ?? 'homologacao';
const SEGREDO_CONNECT = process.env.DS_CONNECT_HMAC ?? '';

if (AMBIENTE === 'producao' && !SEGREDO_CONNECT) {
  console.error('DS_CONNECT_HMAC é obrigatório em produção.'); process.exit(1);
}

type Res = ServerResponse;

const SEG: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  ...(process.env.COOKIE_SEGURO !== 'false' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
};

function json(res: Res, code: number, body: unknown, extra: Record<string, string> = {}) {
  res.writeHead(code, { ...SEG, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(body));
}

async function pagina(res: Res, arquivo: string) {
  res.writeHead(200, {
    ...SEG, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(await readFile(join(PUBLICO, arquivo)));
}

class Erro extends Error { constructor(public codigo: number, msg: string) { super(msg); } }

function corpo(req: IncomingMessage): Promise<string> {
  return new Promise((ok, falha) => {
    let n = 0; const partes: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      n += c.length;
      // pausa em vez de destruir: o socket precisa sobreviver para o 413 chegar ao cliente
      if (n > LIMITE_CORPO) { req.pause(); falha(new Erro(413, 'Requisição grande demais')); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes).toString('utf8')));
    req.on('error', falha);
  });
}

async function corpoJson(req: IncomingMessage) {
  // CSRF: mutação só com JSON — formulário de outro site não envia este tipo sem preflight
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new Erro(415, 'Content-Type deve ser application/json');
  }
  try { return JSON.parse(await corpo(req)); } catch (e) { if (e instanceof Erro) throw e; throw new Erro(400, 'JSON inválido'); }
}

async function exige(req: IncomingMessage): Promise<Usuario> {
  const u = await usuarioDaSessao(req);
  if (!u) throw new Erro(401, 'Sessão expirada');
  return u;
}

const ip = (req: IncomingMessage) =>
  (process.env.CONFIA_PROXY === 'true' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() : '')
  || req.socket.remoteAddress || '?';

const ROTULO: Record<string, string> = {
  'aluno.nome': 'Nome do aluno', 'aluno.nascimento': 'Data de nascimento', 'aluno.endereco': 'Endereço',
  'aluno.bairro': 'Bairro', 'aluno.cep': 'CEP', 'aluno.ficha.contatoEmergenciaNome': 'Contato de emergência — nome',
  'aluno.ficha.contatoEmergenciaFone': 'Contato de emergência — telefone', 'contratante.nome': 'Contratante — nome',
  'contratante.cpf': 'Contratante — CPF válido', 'contratante.email': 'Contratante — e-mail',
  'contratante.telefone': 'Contratante — telefone', 'responsavelFinanceiro.nome': 'Responsável financeiro — nome',
  'responsavelFinanceiro.cpf': 'Responsável financeiro — CPF válido', 'responsavelFinanceiro.email': 'Responsável financeiro — e-mail',
  'responsavelFinanceiro.telefone': 'Responsável financeiro — telefone',
};
const pendencias = (e: ZodError) => [...new Set(e.issues.map((i) => ROTULO[i.path.join('.')] ?? i.path.join('.')))];

const Revogacao = z.object({ canal: CanalImagem, solicitanteNome: z.string().min(3), solicitanteCpf: z.string().min(11) });

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  const rota = `${req.method} ${url.pathname}`;
  try {
    /* ----------------------------- páginas ----------------------------- */
    if (rota === 'GET /login') return pagina(res, 'login.html');
    if (rota === 'GET /' || rota === 'GET /index.html') {
      if (!(await usuarioDaSessao(req))) { res.writeHead(302, { ...SEG, Location: '/login' }); return res.end(); }
      return pagina(res, 'index.html');
    }
    if (rota === 'GET /saude') return json(res, 200, { ok: true });
    const ARQUIVOS_PWA: Record<string, string> = {
      '/favicon.ico': 'image/x-icon',
      '/favicon.png': 'image/png',
      '/favicon-128.png': 'image/png',
      '/icon-192.png': 'image/png',
      '/icon-512.png': 'image/png',
      '/manifest.json': 'application/manifest+json; charset=utf-8',
      '/sw.js': 'application/javascript; charset=utf-8',
      '/balloons.js': 'application/javascript; charset=utf-8',
    };
    if (ARQUIVOS_PWA[url.pathname] && (req.method === 'GET' || req.method === 'HEAD')) {
      const nome = url.pathname.slice(1);
      const buf = await readFile(join(PUBLICO, nome)).catch(() => null);
      if (!buf) { res.writeHead(404); return res.end(); }
      const headers: Record<string, string> = {
        ...SEG,
        'Content-Type': ARQUIVOS_PWA[url.pathname]!,
        'Cache-Control': (url.pathname === '/sw.js' || url.pathname === '/balloons.js') ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400',
      };
      if (url.pathname === '/sw.js') {
        headers['Service-Worker-Allowed'] = '/';
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      return res.end(buf);
    }

    /* ------------------------------ sessão ------------------------------ */
    if (rota === 'POST /api/login') {
      const b = await corpoJson(req);
      const r = await entrar(String(b.email ?? ''), String(b.senha ?? ''), ip(req));
      if (!r.ok) return json(res, 401, { erro: r.motivo });
      return json(res, 200, { nome: r.usuario.nome, papel: r.usuario.papel }, { 'Set-Cookie': cookieSessao(r.token) });
    }
    if (rota === 'POST /api/logout') {
      const t = lerCookie(req); if (t) await sair(t);
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookieSessao('', true) });
    }

    /* ----------------------- Docusign Connect (sem sessão) ----------------------- */
    if (rota === 'POST /ds/webhook') {
      const cru = await corpo(req);
      const valido = verificaHmac(cru, String(req.headers['x-docusign-signature-1'] ?? ''), SEGREDO_CONNECT);
      // sem segredo configurado só é tolerado fora de produção (sandbox do Docusign)
      if (!valido && (AMBIENTE === 'producao' || SEGREDO_CONNECT)) return json(res, 401, { erro: 'assinatura HMAC inválida' });
      let ev; try { ev = JSON.parse(cru); } catch { throw new Erro(400, 'JSON inválido'); }
      return json(res, 200, await processa(ev));
    }

    /* --------------------------- tudo abaixo exige sessão --------------------------- */
    const u = await exige(req);

    if (rota === 'GET /api/config') {
      return json(res, 200, await comEscola(u.escola_id, async (tx) => {
        const ano = Number(url.searchParams.get('ano') ?? 2027);
        const { ctx, escola } = await repo.contexto(tx, u.escola_id, ano);
        return {
          usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel },
          escola: escola.nome_fantasia, ambiente: escola.ambiente, anoLetivo: ano,
          tabelaAprovadaPor: ctx.tabela.aprovadaPor, testemunhas: ctx.testemunhas.length,
          dpaAssinado: ctx.dpaAssinado,
          modoAssinatura: process.env.DS_MODO === 'real' ? 'DOCUSIGN' : 'MOCK',
        };
      }));
    }

    if (rota === 'POST /api/usuario/perfil') {
      const b = await corpoJson(req);
      const nome = String(b.nome ?? '').trim();
      if (!nome || nome.length < 2) throw new Erro(400, 'Nome deve ter pelo menos 2 caracteres');
      await semEscola((tx) => tx.query('update usuario set nome = $1 where id = $2', [nome, u.id]));
      return json(res, 200, { ok: true, nome });
    }

    if (rota === 'POST /api/usuario/senha') {
      const b = await corpoJson(req);
      const senhaAtual = String(b.senhaAtual ?? '');
      const novaSenha = String(b.novaSenha ?? '');
      if (!senhaAtual) throw new Erro(400, 'Informe a senha atual');
      if (novaSenha.length < 6) throw new Erro(400, 'A nova senha deve ter no mínimo 6 caracteres');

      const r = await semEscola((tx) => tx.query('select senha_hash from usuario where id = $1', [u.id]));
      const hashAtual = r.rows[0]?.senha_hash;
      if (!hashAtual || !(await confereSenha(senhaAtual, hashAtual))) {
        throw new Erro(422, 'Senha atual incorreta');
      }

      const novoHash = await hashSenha(novaSenha);
      await semEscola((tx) => tx.query('update usuario set senha_hash = $1 where id = $2', [novoHash, u.id]));
      return json(res, 200, { ok: true, mensagem: 'Senha alterada com sucesso' });
    }

    if (rota === 'POST /api/simular') {
      try { return json(res, 200, await simular(await corpoJson(req), u)); }
      catch (e) { if (e instanceof ZodError) return json(res, 200, { decisao: 'INCOMPLETO', pendencias: pendencias(e) }); throw e; }
    }

    if (rota === 'POST /api/emitir') {
      try {
        const r = await emitir(await corpoJson(req), u);
        return json(res, r.ok ? 201 : 422, r);
      } catch (e) { if (e instanceof ZodError) return json(res, 422, { decisao: 'INCOMPLETO', pendencias: pendencias(e) }); throw e; }
    }

    const doc = url.pathname.match(/^\/api\/documentos\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && doc) {
      const d = await comEscola(u.escola_id, (tx) => repo.documento(tx, doc[1]!));
      if (!d) throw new Erro(404, 'Documento não encontrado');   // de outra escola: inexistente, não "proibido"
      const buf = await le(d.caminho);
      res.writeHead(200, { ...SEG, 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store',
        'Content-Disposition': `inline; filename="${d.nome.replace(/[^\w.-]/g, '_')}"`, 'X-Documento-SHA256': d.sha256 });
      return res.end(buf);
    }

    const tri = url.pathname.match(/^\/api\/matriculas\/(MAT-[\w-]+)\/trilha$/);
    if (req.method === 'GET' && tri) {
      return json(res, 200, await comEscola(u.escola_id, async (tx) => ({
        integridade: await verifica(tx, u.escola_id),
        eventos: await trilha(tx, tri[1]!),
      })));
    }

    const rev = url.pathname.match(/^\/api\/matriculas\/(MAT-[\w-]+)\/consentimento\/revogar$/);
    if (req.method === 'POST' && rev) {
      const b = Revogacao.parse(await corpoJson(req));
      return json(res, 200, await revogar(rev[1]!, b.canal, u, { nome: b.solicitanteNome, cpf: b.solicitanteCpf }));
    }

    throw new Erro(404, 'Rota não encontrada');
  } catch (e) {
    if (e instanceof Erro) {
      json(res, e.codigo, { erro: e.message });
      if (e.codigo === 413) res.socket?.destroy();   // só então corta o envio restante
      return;
    }
    if (e instanceof ZodError) return json(res, 422, { erro: 'Dados inválidos', pendencias: pendencias(e) });
    console.error(JSON.stringify({ nivel: 'erro', rota, msg: (e as Error).message }));
    return json(res, 500, { erro: 'Erro interno' });   // sem detalhe para o cliente
  }
});

servidor.listen(PORTA, () => console.log(JSON.stringify({ nivel: 'info', msg: 'escola nova geração no ar', porta: PORTA, ambiente: AMBIENTE })));

for (const s of ['SIGTERM', 'SIGINT'] as const) {
  process.on(s, () => { servidor.close(); encerraRender().finally(() => process.exit(0)); });
}
