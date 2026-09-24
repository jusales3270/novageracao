import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { semEscola } from '../db/pool.js';
import { confereSenha, hashSenha } from './senha.js';

// hash real de uma senha aleatória: usuário inexistente custa o mesmo tempo que um existente
const HASH_FALSO = hashSenha(randomBytes(24).toString('hex'));

/**
 * Sessão por cookie HttpOnly. O token só existe no navegador; o banco guarda o sha256.
 * Vazar a tabela de sessões não entrega nenhuma sessão válida.
 *
 * CSRF: SameSite=Strict + toda mutação exige Content-Type application/json,
 * que um formulário de outro site não consegue enviar sem preflight.
 */

export const COOKIE = 'ng_sessao';
const DURACAO_H = Number(process.env.SESSAO_HORAS ?? 10);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Usuario {
  id: string; escola_id: string; email: string; nome: string;
  papel: 'SECRETARIA' | 'COORDENACAO' | 'DIRECAO';
}

/* ---------------- limite de tentativas (por IP + e-mail) ---------------- */
const tentativas = new Map<string, { n: number; ate: number }>();
const JANELA = 15 * 60_000, MAX = 5;

export function bloqueado(chave: string): boolean {
  const t = tentativas.get(chave);
  if (!t || t.ate < Date.now()) return false;
  return t.n >= MAX;
}
function falhou(chave: string) {
  const t = tentativas.get(chave);
  if (!t || t.ate < Date.now()) tentativas.set(chave, { n: 1, ate: Date.now() + JANELA });
  else t.n += 1;
}

export async function entrar(email: string, senha: string, ip: string) {
  const chave = `${ip}|${email.toLowerCase()}`;
  if (bloqueado(chave)) return { ok: false as const, motivo: 'Muitas tentativas. Aguarde 15 minutos.' };

  const u = await semEscola(async (tx) => (await tx.query(
    'select id, escola_id, email, nome, papel, senha_hash, ativo from usuario where lower(email) = lower($1)',
    [email])).rows[0]);

  // confere mesmo quando o usuário não existe: o tempo de resposta não revela quais e-mails existem
  const valido = await confereSenha(senha, u?.senha_hash ?? await HASH_FALSO);
  if (!u || !u.ativo || !valido) {
    falhou(chave);
    return { ok: false as const, motivo: 'E-mail ou senha inválidos.' };
  }
  tentativas.delete(chave);

  const token = randomBytes(32).toString('base64url');
  await semEscola((tx) => tx.query(
    `insert into sessao (token_hash, usuario_id, expira_em, ip) values ($1,$2, now() + ($3 || ' hours')::interval, $4)`,
    [sha(token), u.id, String(DURACAO_H), ip]));
  return { ok: true as const, token, usuario: { id: u.id, escola_id: u.escola_id, email: u.email, nome: u.nome, papel: u.papel } };
}

export async function sair(token: string) {
  await semEscola((tx) => tx.query('delete from sessao where token_hash = $1', [sha(token)]));
}

export function lerCookie(req: IncomingMessage): string | null {
  const c = req.headers.cookie ?? '';
  const m = c.split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}

export async function usuarioDaSessao(req: IncomingMessage): Promise<Usuario | null> {
  const token = lerCookie(req);
  if (!token) return null;
  const r = await semEscola((tx) => tx.query<Usuario>(
    `select u.id, u.escola_id, u.email, u.nome, u.papel
       from sessao s join usuario u on u.id = s.usuario_id
      where s.token_hash = $1 and s.expira_em > now() and u.ativo`, [sha(token)]));
  return r.rows[0] ?? null;
}

export function cookieSessao(token: string, apagar = false) {
  const seguro = process.env.COOKIE_SEGURO !== 'false';
  return [
    `${COOKIE}=${apagar ? '' : encodeURIComponent(token)}`,
    'Path=/', 'HttpOnly', 'SameSite=Strict',
    apagar ? 'Max-Age=0' : `Max-Age=${DURACAO_H * 3600}`,
    seguro ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}
