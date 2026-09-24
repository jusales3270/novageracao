import pg from 'pg';

/**
 * Toda operação de negócio roda dentro de `comEscola`, que abre uma transação e
 * seta `app.escola_id`. O RLS do banco faz o resto: uma consulta sem escola
 * setada não enxerga linha nenhuma. O isolamento não depende de a aplicação
 * lembrar de filtrar.
 */

try { process.loadEnvFile?.(); } catch {}

const isRemote = Boolean(
  process.env.DATABASE_URL?.includes('supabase') ||
  process.env.DATABASE_URL?.includes('sslmode=') ||
  process.env.DB_SSL === 'true'
);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
});

pg.types.setTypeParser(1700, (v) => Number(v)); // numeric → number (valores monetários com 2 casas)

export type Tx = pg.PoolClient;

export async function comEscola<T>(escolaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    await tx.query("select set_config('app.escola_id', $1, true)", [escolaId]);
    const r = await fn(tx);
    await tx.query('commit');
    return r;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

/** Consultas fora do escopo de escola: login, sessão, índice de envelope. */
export async function semEscola<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    return await fn(tx);
  } finally {
    tx.release();
  }
}
