import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (s: string, salt: Buffer, len: number, o: object) => Promise<Buffer>;
const PARAM = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Formato: scrypt$N$r$p$salt$hash (base64). Parâmetros no próprio hash para permitir subir custo depois. */
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(senha.normalize('NFKC'), salt, 64, PARAM);
  return ['scrypt', PARAM.N, PARAM.r, PARAM.p, salt.toString('base64'), h.toString('base64')].join('$');
}

export async function confereSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = guardado.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const h = await scrypt(senha.normalize('NFKC'), Buffer.from(salt, 'base64'), esperado.length,
    { N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}
