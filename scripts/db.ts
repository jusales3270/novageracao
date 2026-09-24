import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashSenha } from '../src/auth/senha.js';
import { TABELA_2027 } from '../src/motor/tabela-precos.js';

/**
 * migrate  → aplica db/migrations/*.sql em ordem, uma vez cada (conexão de dono).
 * seed     → escola, tabela 2027, testemunhas e usuário inicial da direção.
 *
 * Seed é idempotente e NÃO aprova a tabela nem marca DPA como assinado:
 * essas duas coisas são decisões da escola (G-03 e G-06), não do deploy.
 */

try { process.loadEnvFile?.(); } catch {}

const OWNER = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
const isRemote = Boolean(
  OWNER?.includes('supabase') ||
  OWNER?.includes('sslmode=') ||
  process.env.DB_SSL === 'true'
);
const cmd = process.argv[2];

function criarClient() {
  return new pg.Client({
    connectionString: OWNER,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  });
}

async function migrate() {
  const c = criarClient();
  await c.connect();

  // Garante que o papel ng_app exista antes dos grants
  let appPass = 'ng_app_senha';
  if (process.env.DATABASE_URL) {
    try {
      appPass = new URL(process.env.DATABASE_URL).password || appPass;
    } catch { /* URL relativa ou padrão */ }
  }
  await c.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ng_app') THEN
        CREATE ROLE ng_app WITH LOGIN PASSWORD '${appPass.replace(/'/g, "''")}';
      ELSE
        ALTER ROLE ng_app WITH LOGIN PASSWORD '${appPass.replace(/'/g, "''")}';
      END IF;
    END
    $$;
  `);

  await c.query('create table if not exists _migracao (nome text primary key, em timestamptz default now())');
  const dir = join(process.cwd(), 'db/migrations');
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
    const ja = await c.query('select 1 from _migracao where nome = $1', [f]);
    if (ja.rowCount) continue;
    await c.query('begin');
    try {
      await c.query(await readFile(join(dir, f), 'utf8'));
      await c.query('insert into _migracao (nome) values ($1)', [f]);
      await c.query('commit');
      console.log('aplicada', f);
    } catch (e) {
      await c.query('rollback');
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  }
  await c.end();
}

async function seed() {
  const c = criarClient();
  await c.connect();
  const senhaInicial = process.env.SEED_SENHA_DIRECAO;
  if (!senhaInicial || senhaInicial.length < 12) {
    throw new Error('Defina SEED_SENHA_DIRECAO com ao menos 12 caracteres.');
  }
  await c.query('begin');
  const e = await c.query<{ id: string }>(
    `insert into escola (razao_social, nome_fantasia, cnpj, endereco, cidade, email_contato, ambiente)
     values ('CNG EDUCAÇÃO LTDA ME','Escola Nova Geração','07.694.200/0001-30',
             'Rua Dr. José Paula Leite de Barros, 136, Centro','Itu/SP','secretaria@novageracaoitu.com.br',$1)
     on conflict (cnpj) do update set nome_fantasia = excluded.nome_fantasia returning id`,
    [process.env.AMBIENTE ?? 'homologacao']);
  const escolaId = e.rows[0]!.id;
  await c.query("select set_config('app.escola_id', $1, true)", [escolaId]);

  const t = TABELA_2027;
  const tp = await c.query<{ id: string }>(
    `insert into tabela_preco (escola_id, ano_letivo, vigencia_inicio, desconto_pontualidade_pct, matricula_cheia, adicionais)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (escola_id, ano_letivo) do update set adicionais = excluded.adicionais returning id`,
    [escolaId, t.anoLetivo, t.vigenciaInicio, t.descontoPontualidadePct, t.matriculaCheia, JSON.stringify(t.adicionais)]);
  for (const l of t.linhas) {
    await c.query(
      `insert into preco_linha (escola_id, tabela_id, faixa, periodo, mensalidade, alimentacao_inclusa,
         descricao_contrato, anuidade_declarada_legado)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tabela_id, faixa, periodo) do nothing`,
      [escolaId, tp.rows[0]!.id, l.faixa, l.periodo, l.mensalidade, l.alimentacaoInclusa,
       l.descricaoContrato, l.anuidadeDeclaradaContrato]);
  }

  await c.query(
    `insert into usuario (escola_id, email, nome, papel, senha_hash)
     values ($1,$2,'Direção','DIRECAO',$3) on conflict (email) do update set nome = excluded.nome`,
    [escolaId, process.env.SEED_EMAIL_DIRECAO ?? 'direcao@novageracaoitu.com.br', await hashSenha(senhaInicial)]);

  // Usuário secretaria para homologação / desenvolvimento local
  const emailSec = process.env.SEED_EMAIL_SECRETARIA ?? 'secretaria@novageracaoitu.com.br';
  const senhaSec = process.env.SEED_SENHA_SECRETARIA ?? 'secretaria-dev-2027';
  await c.query(
    `insert into usuario (escola_id, email, nome, papel, senha_hash)
     values ($1,$2,'Vanessa Prado','SECRETARIA',$3) on conflict (email) do update set nome = excluded.nome`,
    [escolaId, emailSec, await hashSenha(senhaSec)]);

  // Usuário Demo
  await c.query(
    `insert into usuario (escola_id, email, nome, papel, senha_hash)
     values ($1, 'demo@novageracao.com.br', 'Usuário Demo', 'DIRECAO', $2)
     on conflict (email) do update set senha_hash = excluded.senha_hash, nome = excluded.nome, papel = excluded.papel`,
    [escolaId, await hashSenha('demo2222')]);

  // Testemunhas para possibilitar a emissão de contrato em desenvolvimento
  await c.query(
    `insert into testemunha (escola_id, nome, cpf, email, ativa)
     select $1, 'Vanessa Prado', '52998224725', 'vanessa@novageracaoitu.com.br', true
     where not exists (select 1 from testemunha where escola_id = $1 and cpf = '52998224725')`,
    [escolaId]);
  await c.query(
    `insert into testemunha (escola_id, nome, cpf, email, ativa)
     select $1, 'Juliana Retz', '15350946056', 'juliana@novageracaoitu.com.br', true
     where not exists (select 1 from testemunha where escola_id = $1 and cpf = '15350946056')`,
    [escolaId]);

  // Outra escola para validar isolamento multi-tenant / RLS em testes
  const o = await c.query<{ id: string }>(
    `insert into escola (razao_social, nome_fantasia, cnpj, endereco, cidade, email_contato, ambiente)
     values ('OUTRA ESCOLA LTDA','Escola Outra','99.999.999/0001-99','Rua Teste, 1','Itu/SP','intrusa@outra.com','homologacao')
     on conflict (cnpj) do nothing returning id`);
  const outraEscolaId = o.rows[0]?.id ?? (await c.query<{ id: string }>("select id from escola where cnpj = '99.999.999/0001-99'")).rows[0]!.id;
  await c.query(
    `insert into usuario (escola_id, email, nome, papel, senha_hash)
     values ($1,'intrusa@outra.com','Intrusa','SECRETARIA',$2) on conflict (email) do nothing`,
    [outraEscolaId, await hashSenha('intrusa-dev-2027')]);

  if (process.env.AMBIENTE !== 'producao') {
    // Aprovação formal da tabela 2027 pela direção para liberação da emissão em dev
    await c.query(
      `update tabela_preco set aprovada_por = 'Marlene Modesto da Silva' where id = $1 and aprovada_por is null`,
      [tp.rows[0]!.id]);
  }

  await c.query('commit');
  await c.end();
  console.log('seed ok · escola', escolaId);
  console.log('usuários prontos:');
  console.log(' - Direção:', process.env.SEED_EMAIL_DIRECAO ?? 'direcao@novageracaoitu.com.br');
  console.log(' - Secretaria:', emailSec);
}

if (cmd === 'migrate') await migrate();
else if (cmd === 'seed') await seed();
else { console.error('uso: tsx scripts/db.ts migrate|seed'); process.exit(2); }
