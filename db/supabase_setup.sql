-- ====================================================================
-- ESCOLA NOVA GERAÇÃO — SETUP COMPLETO PARA O SUPABASE
-- Execute este script no SQL Editor do Supabase (Dashboard -> SQL Editor -> New Query)
-- ====================================================================

-- 1. Extensões
create extension if not exists pgcrypto;

-- 2. Tabela de controle de migrações
create table if not exists _migracao (
  nome text primary key,
  em timestamptz default now()
);

-- ====================================================================
-- ESCOLA E CONFIGURAÇÃO
-- ====================================================================
create table if not exists escola (
  id            uuid primary key default gen_random_uuid(),
  razao_social  text not null,
  nome_fantasia text not null,
  cnpj          text not null unique,
  endereco      text not null,
  cidade        text not null,
  email_contato text not null,
  ambiente      text not null default 'homologacao'
                check (ambiente in ('sandbox','homologacao','producao')),
  dpa_assinado_em timestamptz,
  dpa_assinado_por text,
  criada_em     timestamptz not null default now()
);

create table if not exists testemunha (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  nome       text not null,
  cpf        text not null,
  email      text not null,
  ativa      boolean not null default true
);

-- ====================================================================
-- AUTENTICAÇÃO E SESSÕES
-- ====================================================================
create table if not exists usuario (
  id          uuid primary key default gen_random_uuid(),
  escola_id   uuid not null references escola(id),
  email       text not null unique,
  nome        text not null,
  papel       text not null check (papel in ('SECRETARIA','COORDENACAO','DIRECAO')),
  senha_hash  text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table if not exists sessao (
  token_hash  text primary key,
  usuario_id  uuid not null references usuario(id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  ip          text
);
create index if not exists idx_sessao_usuario_id on sessao (usuario_id);

-- ====================================================================
-- PREÇOS E TABELAS
-- ====================================================================
create table if not exists tabela_preco (
  id                uuid primary key default gen_random_uuid(),
  escola_id         uuid not null references escola(id),
  ano_letivo        int  not null,
  vigencia_inicio   date not null,
  aprovada_por      text,
  aprovada_em       timestamptz,
  desconto_pontualidade_pct numeric(5,2) not null default 5,
  matricula_cheia   numeric(12,2) not null,
  adicionais        jsonb not null,
  unique (escola_id, ano_letivo)
);

create table if not exists preco_linha (
  id               uuid primary key default gen_random_uuid(),
  escola_id        uuid not null references escola(id),
  tabela_id        uuid not null references tabela_preco(id) on delete cascade,
  faixa            text not null,
  periodo          text not null check (periodo in ('MEIO','INTEGRAL')),
  mensalidade      numeric(12,2) not null check (mensalidade > 0),
  alimentacao_inclusa boolean not null default false,
  descricao_contrato  text not null,
  anuidade_declarada_legado numeric(12,2),
  unique (tabela_id, faixa, periodo)
);

-- ====================================================================
-- CADASTRO DE PESSOAS E ALUNOS
-- ====================================================================
create table if not exists pessoa (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  nome       text not null,
  cpf        text not null,
  email      text,
  telefone   text,
  unique (escola_id, cpf)
);

create table if not exists aluno (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  nome         text not null,
  nascimento   date not null,
  endereco     text not null,
  bairro       text not null,
  cidade       text not null,
  cep          text not null,
  irmaos       jsonb not null default '[]',
  restricao_judicial text,
  criado_em    timestamptz not null default now()
);

create table if not exists ficha_saude (
  aluno_id     uuid primary key references aluno(id) on delete cascade,
  escola_id    uuid not null references escola(id),
  dados        jsonb not null,
  prescricao_anexada boolean not null default false,
  atualizada_em timestamptz not null default now()
);

create table if not exists autorizado_retirada (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  aluno_id   uuid not null references aluno(id) on delete cascade,
  nome       text not null,
  telefone   text not null,
  vinculo    text
);

-- ====================================================================
-- MATRÍCULA E DOCUMENTAÇÃO
-- ====================================================================
create table if not exists matricula (
  id            text primary key,
  escola_id     uuid not null references escola(id),
  aluno_id      uuid not null references aluno(id),
  contratante_id uuid not null references pessoa(id),
  financeiro_id  uuid not null references pessoa(id),
  tabela_id     uuid not null references tabela_preco(id),
  ano_letivo    int not null,
  tipo          text not null check (tipo in ('MATRICULA','REMATRICULA')),
  turma         text not null,
  periodo       text not null,
  servicos      jsonb not null,
  forma_pagamento_matricula text not null,
  desconto_excepcional_pct numeric(5,2) not null default 0,
  justificativa_desconto text,
  operador_id   uuid not null references usuario(id),
  operador_papel text not null,
  calculo       jsonb,
  decisao_motor text not null check (decisao_motor in ('LIBERADO','BLOQUEADO')),
  assinatura_logica text not null,
  status        text not null default 'registrada'
                check (status in ('registrada','documentos_gerados','enviada','concluida','falha_envio','recusada')),
  criada_em     timestamptz not null default now()
);
create index if not exists idx_matricula_escola_ano on matricula (escola_id, ano_letivo);

create table if not exists alteracao_contratual (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  matricula_id text not null references matricula(id),
  motivo       text not null,
  descricao    text not null,
  solicitado_por uuid not null references usuario(id),
  observacao   text,
  nova_matricula_id text references matricula(id),
  em           timestamptz not null default now()
);

create table if not exists consentimento_imagem (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  matricula_id text not null references matricula(id),
  canal        text not null check (canal in
                 ('SITE','REDES_SOCIAIS','ALBUM_TURMA','USO_PEDAGOGICO_INTERNO','MATERIAL_IMPRESSO')),
  concedido    boolean not null,
  por_cpf      text not null,
  por_nome     text not null,
  canal_coleta text not null,
  em           timestamptz not null default now()
);
create index if not exists idx_consentimento_imagem on consentimento_imagem (matricula_id, canal, em desc);

create or replace function pode_publicar(p_matricula text, p_canal text, p_quando timestamptz)
returns boolean language sql stable as $$
  select coalesce(
    (select concedido from consentimento_imagem
      where matricula_id = p_matricula and canal = p_canal and em <= p_quando
      order by em desc limit 1),
    false);
$$;

create table if not exists documento (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  matricula_id text not null references matricula(id),
  tipo         text not null check (tipo in ('REQUERIMENTO','CONTRATO','ANEXO','ASSINADO')),
  nome         text not null,
  sha256       text not null,
  bytes        int not null,
  caminho      text not null,
  gerado_em    timestamptz not null default now()
);

create table if not exists envelope (
  id            uuid primary key default gen_random_uuid(),
  escola_id     uuid not null references escola(id),
  matricula_id  text not null references matricula(id),
  provedor      text not null default 'DOCUSIGN',
  envelope_id   text not null,
  modo          text not null check (modo in ('MOCK','DOCUSIGN')),
  status        text not null,
  enviado_em    timestamptz not null default now(),
  concluido_em  timestamptz,
  unique (provedor, envelope_id)
);

create table if not exists envelope_signatario (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  envelope_id  uuid not null references envelope(id) on delete cascade,
  papel        text not null check (papel in
                 ('CONTRATANTE','RESPONSAVEL_FINANCEIRO','ESCOLA','TESTEMUNHA')),
  nome         text not null,
  email        text not null,
  cpf          text,
  ordem        int not null,
  status       text not null default 'enviado',
  assinado_em  timestamptz
);

create table if not exists webhook_evento (
  chave        text primary key,
  recebido_em  timestamptz not null default now(),
  corpo        jsonb not null
);

create table if not exists envelope_indice (
  envelope_id text primary key,
  escola_id   uuid not null references escola(id)
);

-- ====================================================================
-- CADEIA DE EVIDÊNCIA (APPEND-ONLY)
-- ====================================================================
create table if not exists evento_ledger (
  seq           bigserial primary key,
  escola_id     uuid not null references escola(id),
  matricula_id  text,
  tipo          text not null,
  ator          text not null,
  payload       jsonb not null,
  hash_anterior text not null,
  hash          text not null unique,
  em            timestamptz not null default now()
);
create index if not exists idx_evento_ledger_seq on evento_ledger (escola_id, seq desc);

create or replace function bloqueia_alteracao() returns trigger language plpgsql as $$
begin
  raise exception 'evento_ledger é append-only (tentativa de % no seq %)', tg_op, old.seq;
end $$;

drop trigger if exists ledger_append_only on evento_ledger;
create trigger ledger_append_only before update or delete on evento_ledger
  for each row execute function bloqueia_alteracao();

-- ====================================================================
-- ROW LEVEL SECURITY (RLS) MULTI-TENANT POR ESCOLA
-- ====================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'testemunha','tabela_preco','preco_linha','pessoa','aluno','ficha_saude',
    'autorizado_retirada','matricula','alteracao_contratual','consentimento_imagem',
    'documento','envelope','envelope_signatario','evento_ledger'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists tenant on %I', t);
    execute format($f$create policy tenant on %I
      using (
        escola_id = nullif(current_setting('app.escola_id', true), '')::uuid
        or (nullif(current_setting('app.escola_id', true), '') is null and current_user in ('postgres','service_role','supabase_admin'))
      )
      with check (
        escola_id = nullif(current_setting('app.escola_id', true), '')::uuid
        or (nullif(current_setting('app.escola_id', true), '') is null and current_user in ('postgres','service_role','supabase_admin'))
      )$f$, t);
  end loop;
end $$;

alter table escola enable row level security;
drop policy if exists tenant on escola;
create policy tenant on escola
  using (
    id = nullif(current_setting('app.escola_id', true), '')::uuid
    or (nullif(current_setting('app.escola_id', true), '') is null and current_user in ('postgres','service_role','supabase_admin'))
  );

-- ====================================================================
-- PERMISSÕES / GRANTS
-- ====================================================================
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Defesa em profundidade no ledger
revoke update, delete on evento_ledger from anon, authenticated, service_role;
revoke update, delete on webhook_evento from anon, authenticated, service_role;

-- ====================================================================
-- DADOS INICIAIS (SEED IDEMPOTENTE)
-- ====================================================================
do $$
declare
  v_escola_id uuid;
  v_outra_escola_id uuid;
  v_tabela_id uuid;
begin
  -- 1. Escola Principal: Escola Nova Geração
  insert into escola (razao_social, nome_fantasia, cnpj, endereco, cidade, email_contato, ambiente)
  values (
    'CNG EDUCAÇÃO LTDA ME',
    'Escola Nova Geração',
    '07.694.200/0001-30',
    'Rua Dr. José Paula Leite de Barros, 136, Centro',
    'Itu/SP',
    'secretaria@novageracaoitu.com.br',
    'homologacao'
  )
  on conflict (cnpj) do update set nome_fantasia = excluded.nome_fantasia
  returning id into v_escola_id;

  if v_escola_id is null then
    select id into v_escola_id from escola where cnpj = '07.694.200/0001-30';
  end if;

  -- 2. Tabela de Preço 2027 Aprovada
  insert into tabela_preco (
    escola_id, ano_letivo, vigencia_inicio, aprovada_por, aprovada_em,
    desconto_pontualidade_pct, matricula_cheia, adicionais
  )
  values (
    v_escola_id, 2027, '2026-08-01', 'Marlene Modesto da Silva', now(),
    5.00, 1821.46,
    '{"almoco": 570, "almocoJantar": 800, "fraldarioMeio": 270, "horaAdicional": 27, "almocoOuJantar": 530, "fraldarioAvulso": 27, "fraldarioIntegral": 485}'::jsonb
  )
  on conflict (escola_id, ano_letivo) do update
    set aprovada_por = excluded.aprovada_por,
        aprovada_em = coalesce(tabela_preco.aprovada_em, excluded.aprovada_em),
        adicionais = excluded.adicionais
  returning id into v_tabela_id;

  if v_tabela_id is null then
    select id into v_tabela_id from tabela_preco where escola_id = v_escola_id and ano_letivo = 2027;
  end if;

  -- 3. Linhas da Tabela de Preços (6 faixas / períodos)
  insert into preco_linha (escola_id, tabela_id, faixa, periodo, mensalidade, alimentacao_inclusa, descricao_contrato, anuidade_declarada_legado)
  values
    (v_escola_id, v_tabela_id, 'BERCARIO', 'MEIO', 2185.62, false, '04 horas diárias: 7h30–11h30 ou 13h00–17h00', 26227.49),
    (v_escola_id, v_tabela_id, 'BERCARIO', 'INTEGRAL', 3693.94, true, 'Até 10h diárias (almoço, jantar e banho)', 46056.33),
    (v_escola_id, v_tabela_id, 'MINI_MATERNAL', 'MEIO', 2012.25, false, '04 horas diárias: 7h30–11h30 ou 13h00–17h00', 24146.94),
    (v_escola_id, v_tabela_id, 'MINI_MATERNAL', 'INTEGRAL', 3004.79, false, 'Até 10h diárias (04h educacional + 06h recreação)', 36057.50),
    (v_escola_id, v_tabela_id, 'MATERNAL_JARDIM_ALFA', 'MEIO', 2080.13, false, '04 horas diárias: 7h30–11h30 ou 13h00–17h00', 24961.61),
    (v_escola_id, v_tabela_id, 'MATERNAL_JARDIM_ALFA', 'INTEGRAL', 3072.68, false, 'Até 10h diárias (04h educacional + 06h recreação)', 36872.17)
  on conflict (tabela_id, faixa, periodo) do nothing;

  -- 4. Testemunhas para Emissão de Contrato (garantia de exatamente 2 testemunhas ativas)
  insert into testemunha (escola_id, nome, cpf, email, ativa)
  select v_escola_id, 'Vanessa Prado', '52998224725', 'vanessa@novageracaoitu.com.br', true
  where not exists (select 1 from testemunha where escola_id = v_escola_id and cpf = '52998224725');

  insert into testemunha (escola_id, nome, cpf, email, ativa)
  select v_escola_id, 'Juliana Retz', '15350946056', 'juliana@novageracaoitu.com.br', true
  where not exists (select 1 from testemunha where escola_id = v_escola_id and cpf = '15350946056');

  -- 5. Usuários de Acesso com senhas prontas (scrypt nativo)
  -- 5.1 Direção: direcao@novageracaoitu.com.br (senha: direcao-dev-2027!)
  insert into usuario (escola_id, email, nome, papel, senha_hash)
  values (
    v_escola_id,
    'direcao@novageracaoitu.com.br',
    'Camila Ribeiro',
    'DIRECAO',
    'scrypt$16384$8$1$IBxTfFiOqwqKbJsjBN8Ebg==$YWPLB9JFUU3FoqbJpJqo124eppz35pH2IpLIb8jrI7/o6tF7wP79QuIBejhVgezU6e3zr/OG5HLgWaepLzDubA=='
  )
  on conflict (email) do update set senha_hash = excluded.senha_hash, nome = excluded.nome;

  -- 5.2 Secretaria: secretaria@novageracaoitu.com.br (senha: secretaria-dev-2027)
  insert into usuario (escola_id, email, nome, papel, senha_hash)
  values (
    v_escola_id,
    'secretaria@novageracaoitu.com.br',
    'Vanessa Prado',
    'SECRETARIA',
    'scrypt$16384$8$1$bXufm4YaFqK3LwWf/6hCxA==$6IeBKoge+LfYQS3cdz/jaW5kKuKKy8FHKcGBpmOzPt58ArWH0a+6BPQ3T1cKZzDcsqQnjpSg+7T3Vj7AM49iqA=='
  )
  on conflict (email) do update set senha_hash = excluded.senha_hash, nome = excluded.nome;

  -- 5.3 Usuário Demo: demo@novageracao.com.br (senha: demo2222)
  insert into usuario (escola_id, email, nome, papel, senha_hash)
  values (
    v_escola_id,
    'demo@novageracao.com.br',
    'Usuário Demo',
    'DIRECAO',
    'scrypt$16384$8$1$5a/PkZE4JIV5XRQ3/cy5KQ==$70sDqeRBih3FZvWYSD/458VJAnH3VjPYjdlVRVRgnnJS6738R4w/p8Dd+bEpuF4SCd77VxZyj55P/UIh9dB6sw=='
  )
  on conflict (email) do update set senha_hash = excluded.senha_hash, nome = excluded.nome;

  -- 6. Escola Secundária para validação multi-tenant / RLS
  insert into escola (razao_social, nome_fantasia, cnpj, endereco, cidade, email_contato, ambiente)
  values (
    'OUTRA ESCOLA LTDA',
    'Escola Outra',
    '99.999.999/0001-99',
    'Rua Teste, 1',
    'Itu/SP',
    'intrusa@outra.com',
    'homologacao'
  )
  on conflict (cnpj) do nothing
  returning id into v_outra_escola_id;

  if v_outra_escola_id is null then
    select id into v_outra_escola_id from escola where cnpj = '99.999.999/0001-99';
  end if;

  insert into usuario (escola_id, email, nome, papel, senha_hash)
  values (
    v_outra_escola_id,
    'intrusa@outra.com',
    'Intrusa',
    'SECRETARIA',
    'scrypt$16384$8$1$xwli9EjzrIRQBPVV8aJmDQ==$jN8nWOf/Frm1jkwbBL6FkfVDtW3MdOXAqi+5R2iDDrlFhZ8228ytPPtrOGo/VFTjkKLO3nYFRSLChEKZBJApmw=='
  )
  on conflict (email) do nothing;

  -- 7. Registrar histórico de migrações
  insert into _migracao (nome) values ('001_schema.sql') on conflict do nothing;
  insert into _migracao (nome) values ('002_grants.sql') on conflict do nothing;

  raise notice 'Setup Supabase concluído com sucesso para a escola %', v_escola_id;
end $$;
