-- Escola Nova Geração — migração 001
-- Postgres 16. Isolamento por escola via RLS em toda tabela de negócio.
--
-- Papéis:
--   ng_owner  → dono do esquema, roda migrações.
--   ng_app    → a aplicação. NÃO é dono de nada, portanto está sujeito ao RLS
--               sem depender de FORCE. É o que torna o isolamento real.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ --
-- Escola e configuração
-- ------------------------------------------------------------------ --
create table escola (
  id            uuid primary key default gen_random_uuid(),
  razao_social  text not null,
  nome_fantasia text not null,
  cnpj          text not null unique,
  endereco      text not null,
  cidade        text not null,
  email_contato text not null,
  ambiente      text not null default 'homologacao'
                check (ambiente in ('sandbox','homologacao','producao')),
  -- R-12: contrato de operador (LGPD art. 39). Sem ele, produção bloqueia.
  dpa_assinado_em timestamptz,
  dpa_assinado_por text,
  criada_em     timestamptz not null default now()
);

create table testemunha (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  nome       text not null,
  cpf        text not null,
  email      text not null,
  ativa      boolean not null default true
);

-- ------------------------------------------------------------------ --
-- Autenticação — fora do RLS: o login ocorre antes de a escola ser conhecida.
-- O perfil (papel) vem daqui e nunca do corpo da requisição.
-- ------------------------------------------------------------------ --
create table usuario (
  id          uuid primary key default gen_random_uuid(),
  escola_id   uuid not null references escola(id),
  email       text not null unique,
  nome        text not null,
  papel       text not null check (papel in ('SECRETARIA','COORDENACAO','DIRECAO')),
  senha_hash  text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table sessao (
  token_hash  text primary key,           -- sha256 do token; o token em si nunca é gravado
  usuario_id  uuid not null references usuario(id) on delete cascade,
  criada_em   timestamptz not null default now(),
  expira_em   timestamptz not null,
  ip          text
);
create index on sessao (usuario_id);

-- ------------------------------------------------------------------ --
-- Preço — fonte única. Anuidade não é coluna: é mensalidade × 12.
-- ------------------------------------------------------------------ --
create table tabela_preco (
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

create table preco_linha (
  id               uuid primary key default gen_random_uuid(),
  escola_id        uuid not null references escola(id),
  tabela_id        uuid not null references tabela_preco(id) on delete cascade,
  faixa            text not null,
  periodo          text not null check (periodo in ('MEIO','INTEGRAL')),
  mensalidade      numeric(12,2) not null check (mensalidade > 0),
  alimentacao_inclusa boolean not null default false,
  descricao_contrato  text not null,
  -- só para reconciliar contra o contrato legado (R-01); nunca entra em cálculo
  anuidade_declarada_legado numeric(12,2),
  unique (tabela_id, faixa, periodo)
);

-- ------------------------------------------------------------------ --
-- Cadastro
-- ------------------------------------------------------------------ --
create table pessoa (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  nome       text not null,
  cpf        text not null,
  email      text,
  telefone   text,
  unique (escola_id, cpf)
);

create table aluno (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  nome         text not null,
  nascimento   date not null,
  endereco     text not null, bairro text not null, cidade text not null, cep text not null,
  irmaos       jsonb not null default '[]',
  restricao_judicial text,
  criado_em    timestamptz not null default now()
);

-- Dado sensível de criança (LGPD arts. 11 e 14) em tabela própria.
create table ficha_saude (
  aluno_id     uuid primary key references aluno(id) on delete cascade,
  escola_id    uuid not null references escola(id),
  dados        jsonb not null,
  prescricao_anexada boolean not null default false,
  atualizada_em timestamptz not null default now()
);

create table autorizado_retirada (
  id         uuid primary key default gen_random_uuid(),
  escola_id  uuid not null references escola(id),
  aluno_id   uuid not null references aluno(id) on delete cascade,
  nome       text not null, telefone text not null, vinculo text
);

-- ------------------------------------------------------------------ --
-- Matrícula
-- ------------------------------------------------------------------ --
create table matricula (
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
create index on matricula (escola_id, ano_letivo);

create table alteracao_contratual (
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

-- Consentimento: evento com vigência, nunca coluna booleana (Cl. 16ª).
create table consentimento_imagem (
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
create index on consentimento_imagem (matricula_id, canal, em desc);

create or replace function pode_publicar(p_matricula text, p_canal text, p_quando timestamptz)
returns boolean language sql stable as $$
  select coalesce(
    (select concedido from consentimento_imagem
      where matricula_id = p_matricula and canal = p_canal and em <= p_quando
      order by em desc limit 1),
    false);  -- fail-closed: ausência de decisão nunca é autorização
$$;

-- ------------------------------------------------------------------ --
-- Documentos e envelope
-- ------------------------------------------------------------------ --
create table documento (
  id           uuid primary key default gen_random_uuid(),   -- não adivinhável: é o que vai na URL
  escola_id    uuid not null references escola(id),
  matricula_id text not null references matricula(id),
  tipo         text not null check (tipo in ('REQUERIMENTO','CONTRATO','ANEXO','ASSINADO')),
  nome         text not null,
  sha256       text not null,
  bytes        int not null,
  caminho      text not null,
  gerado_em    timestamptz not null default now()
);

create table envelope (
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

create table envelope_signatario (
  id           uuid primary key default gen_random_uuid(),
  escola_id    uuid not null references escola(id),
  envelope_id  uuid not null references envelope(id) on delete cascade,
  papel        text not null check (papel in
                 ('CONTRATANTE','RESPONSAVEL_FINANCEIRO','ESCOLA','TESTEMUNHA')),
  nome         text not null, email text not null, cpf text,
  ordem        int not null,
  status       text not null default 'enviado',
  assinado_em  timestamptz
);

-- Idempotência do Connect: o Docusign reenvia. O mesmo evento entra uma vez.
-- Fora do RLS: o webhook chega sem sessão e descobre a escola pelo envelope.
create table webhook_evento (
  chave        text primary key,       -- envelopeId:evento:recipient:timestamp
  recebido_em  timestamptz not null default now(),
  corpo        jsonb not null
);

-- ------------------------------------------------------------------ --
-- Cadeia de evidência — append-only, encadeada por escola.
-- ------------------------------------------------------------------ --
create table evento_ledger (
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
create index on evento_ledger (escola_id, seq desc);

create or replace function bloqueia_alteracao() returns trigger language plpgsql as $$
begin
  raise exception 'evento_ledger é append-only (tentativa de % no seq %)', tg_op, old.seq;
end $$;
create trigger ledger_append_only before update or delete on evento_ledger
  for each row execute function bloqueia_alteracao();

-- ------------------------------------------------------------------ --
-- RLS em toda tabela de negócio. A aplicação seta app.escola_id por transação.
-- ------------------------------------------------------------------ --
do $$
declare t text;
begin
  foreach t in array array[
    'testemunha','tabela_preco','preco_linha','pessoa','aluno','ficha_saude',
    'autorizado_retirada','matricula','alteracao_contratual','consentimento_imagem',
    'documento','envelope','envelope_signatario','evento_ledger'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($f$create policy tenant on %I
      using (escola_id = nullif(current_setting('app.escola_id', true), '')::uuid)
      with check (escola_id = nullif(current_setting('app.escola_id', true), '')::uuid)$f$, t);
  end loop;
end $$;

-- escola: só a própria linha é visível para a aplicação.
-- Sem FORCE: provisionar escola é operação do dono, que ainda não tem escola para setar.
-- ng_app não é dono, então continua sob RLS.
alter table escola enable row level security;
create policy tenant on escola
  using (id = nullif(current_setting('app.escola_id', true), '')::uuid);

-- Webhook chega sem sessão e precisa descobrir a escola pelo envelope.
-- Índice sem RLS com só o vínculo (ids aleatórios, sem dado pessoal).
create table envelope_indice (
  envelope_id text primary key,
  escola_id   uuid not null references escola(id)
);
