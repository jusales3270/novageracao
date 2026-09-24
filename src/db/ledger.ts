import { createHash } from 'node:crypto';
import type { Tx } from './pool.js';

/**
 * Cadeia de evidência persistida. Encadeada por escola.
 *
 * O advisory lock por escola serializa a leitura do último hash e a inserção
 * do próximo — sem ele, duas emissões simultâneas leriam o mesmo "último" e
 * gravariam dois elos com o mesmo hash_anterior, rompendo a cadeia.
 */

const GENESE = '0'.repeat(64);

export interface EventoLedger {
  seq: number;
  escola_id: string;
  matricula_id: string | null;
  tipo: string;
  ator: string;
  payload: unknown;
  hash_anterior: string;
  hash: string;
  em: string;
}

const canon = (o: unknown): string =>
  JSON.stringify(o, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

function calcula(e: { escolaId: string; matriculaId: string | null; tipo: string; ator: string;
  payload: unknown; hashAnterior: string; em: string }) {
  return createHash('sha256')
    .update(canon({ escola: e.escolaId, matricula: e.matriculaId, tipo: e.tipo, ator: e.ator,
      payload: e.payload, anterior: e.hashAnterior, em: e.em }))
    .digest('hex');
}

export async function registra(
  tx: Tx, escolaId: string, matriculaId: string | null,
  tipo: string, ator: string, payload: unknown,
): Promise<EventoLedger> {
  await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`ledger:${escolaId}`]);
  const ult = await tx.query<{ hash: string }>(
    'select hash from evento_ledger where escola_id = $1 order by seq desc limit 1', [escolaId]);
  const hashAnterior = ult.rows[0]?.hash ?? GENESE;
  const em = new Date().toISOString();
  const hash = calcula({ escolaId, matriculaId, tipo, ator, payload, hashAnterior, em });
  const r = await tx.query<EventoLedger>(
    `insert into evento_ledger (escola_id, matricula_id, tipo, ator, payload, hash_anterior, hash, em)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [escolaId, matriculaId, tipo, ator, JSON.stringify(payload), hashAnterior, hash, em]);
  return r.rows[0]!;
}

/** Recalcula a cadeia inteira da escola e aponta o primeiro elo rompido. */
export async function verifica(tx: Tx, escolaId: string) {
  const r = await tx.query<EventoLedger>(
    'select * from evento_ledger where escola_id = $1 order by seq asc', [escolaId]);
  let anterior = GENESE;
  for (const e of r.rows) {
    const esperado = calcula({ escolaId, matriculaId: e.matricula_id, tipo: e.tipo, ator: e.ator,
      payload: e.payload, hashAnterior: anterior, em: new Date(e.em).toISOString() });
    if (e.hash_anterior !== anterior || e.hash !== esperado) {
      return { integra: false, rompeuEm: e.seq, eventos: r.rowCount ?? 0 };
    }
    anterior = e.hash;
  }
  return { integra: true, raiz: anterior, eventos: r.rowCount ?? 0 };
}

export async function trilha(tx: Tx, matriculaId: string) {
  const r = await tx.query<EventoLedger>(
    'select seq, tipo, ator, hash, em, payload from evento_ledger where matricula_id = $1 order by seq',
    [matriculaId]);
  return r.rows;
}
