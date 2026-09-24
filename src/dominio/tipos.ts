import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Vocabulário do domínio — nomes iguais aos do papel que a escola usa.
 * ------------------------------------------------------------------ */

export const Turma = z.enum([
  'BERCARIO',
  'MINI_MATERNAL',
  'MATERNAL',
  'JARDIM',
  'ALFA_I',
  'ALFA_II',
]);
export type Turma = z.infer<typeof Turma>;

export const Periodo = z.enum(['MEIO', 'INTEGRAL']);
export type Periodo = z.infer<typeof Periodo>;

/** Turmas que compartilham a mesma faixa de preço (Cl. 8ª do contrato). */
export const FAIXA_PRECO: Record<Turma, string> = {
  BERCARIO: 'BERCARIO',
  MINI_MATERNAL: 'MINI_MATERNAL',
  MATERNAL: 'MATERNAL_JARDIM_ALFA',
  JARDIM: 'MATERNAL_JARDIM_ALFA',
  ALFA_I: 'MATERNAL_JARDIM_ALFA',
  ALFA_II: 'MATERNAL_JARDIM_ALFA',
};

export const ROTULO_TURMA: Record<Turma, string> = {
  BERCARIO: 'Berçário',
  MINI_MATERNAL: 'Mini-Maternal',
  MATERNAL: 'Maternal',
  JARDIM: 'Jardim',
  ALFA_I: 'Alfa I',
  ALFA_II: 'Alfa II',
};

export const ROTULO_PERIODO: Record<Periodo, string> = {
  MEIO: '½ período',
  INTEGRAL: 'Integral',
};

/* ---------------------------- Pessoas ---------------------------- */

const cpf = z
  .string()
  .transform((s) => s.replace(/\D/g, ''))
  .refine(validaCPF, 'CPF inválido');

export const Responsavel = z.object({
  nome: z.string().min(3),
  cpf,
  rg: z.string().optional(),
  email: z.string().email(),
  telefone: z.string().min(10),
  nascimento: z.string().optional(),
  profissao: z.string().optional(),
});
export type Responsavel = z.infer<typeof Responsavel>;

/**
 * Ficha de saúde. Dado pessoal sensível de criança (LGPD art. 11 c/c art. 14).
 * Modelada em objeto próprio para permitir criptografia em repouso e
 * política de acesso distinta do cadastro comum.
 */
export const FichaSaude = z.object({
  usoContinuoMedicamento: z.boolean(),
  qualMedicamento: z.string().optional(),
  alergico: z.boolean(),
  qualAlergia: z.string().optional(),
  intoleranciaAlimentar: z.string().optional(),
  convenio: z.string().optional(),
  antitermicoAutorizado: z.string().optional(),
  /** Cl. 13ª §1º — prescrição médica anexada ao requerimento. Por aluno, nunca global. */
  prescricaoAnexada: z.boolean().default(false),
  acompanhamentoClinico: z.string().optional(),
  comprometimento: z.string().optional(),
  sindrome: z.string().optional(),
  contatoEmergenciaNome: z.string().min(3),
  contatoEmergenciaFone: z.string().min(10),
});
export type FichaSaude = z.infer<typeof FichaSaude>;

export const PessoaAutorizadaRetirada = z.object({
  nome: z.string().min(3),
  telefone: z.string().min(10),
  vinculo: z.string().optional(),
});

export const Aluno = z.object({
  nome: z.string().min(3),
  nascimento: z.string(),
  endereco: z.string().min(5),
  bairro: z.string(),
  cidade: z.string().default('Itu'),
  cep: z.string(),
  irmaos: z.array(z.string()).default([]),
  ficha: FichaSaude,
  autorizadosRetirada: z.array(PessoaAutorizadaRetirada).max(6).default([]),
  /** Cl. 12ª §1º — restrição de guarda / decisão judicial. */
  restricaoJudicial: z.string().optional(),
});
export type Aluno = z.infer<typeof Aluno>;

/* ------------------------- Serviços contratados ------------------------- */

export const Alimentacao = z.enum(['NENHUMA', 'ALMOCO', 'ALMOCO_JANTAR', 'ALMOCO_OU_JANTAR']);
export const Fraldario = z.enum(['NENHUM', 'MEIO', 'INTEGRAL', 'AVULSO']);

export const ServicosContratados = z.object({
  turma: Turma,
  periodo: Periodo,
  alimentacao: Alimentacao.default('NENHUMA'),
  fraldario: Fraldario.default('NENHUM'),
  horaAdicionalDiasMes: z.number().int().min(0).max(31).default(0),
});
export type ServicosContratados = z.infer<typeof ServicosContratados>;

/* ---------------------------- Consentimento ---------------------------- */

/**
 * Cl. 16ª exige autorização "específica, destacada, facultativa e revogável".
 * Consentimento é evento com vigência, nunca coluna booleana. Um "sim"
 * global no formulário de matrícula não satisfaz a cláusula.
 */
export const CanalImagem = z.enum([
  'SITE',
  'REDES_SOCIAIS',
  'ALBUM_TURMA',
  'USO_PEDAGOGICO_INTERNO',
  'MATERIAL_IMPRESSO',
]);
export type CanalImagem = z.infer<typeof CanalImagem>;

export const ROTULO_CANAL: Record<CanalImagem, string> = {
  SITE: 'Site institucional',
  REDES_SOCIAIS: 'Redes sociais (Instagram, Facebook)',
  ALBUM_TURMA: 'Álbum compartilhado da turma',
  USO_PEDAGOGICO_INTERNO: 'Uso pedagógico interno (FOA, portfólio)',
  MATERIAL_IMPRESSO: 'Material impresso e institucional',
};

export const EventoConsentimento = z.object({
  canal: CanalImagem,
  concedido: z.boolean(),
  em: z.string(),
  porCpf: cpf,
  porNome: z.string(),
  canalColeta: z.enum(['REQUERIMENTO', 'PORTAL', 'EMAIL', 'PRESENCIAL']),
});
export type EventoConsentimento = z.infer<typeof EventoConsentimento>;

/* ---------------------------- Matrícula ---------------------------- */

export const FormaPagamentoMatricula = z.enum([
  'AVISTA_ATE_31_08',
  'AVISTA_ATE_15_09',
  'AVISTA_1X',
  'CARTAO_2X',
  'CARTAO_3X',
  'CARTAO_4X',
  'CARTAO_5X',
  'CARTAO_6X',
]);
export type FormaPagamentoMatricula = z.infer<typeof FormaPagamentoMatricula>;

export const PapelOperador = z.enum(['SECRETARIA', 'COORDENACAO', 'DIRECAO']);
export type PapelOperador = z.infer<typeof PapelOperador>;

export const Operador = z.object({
  nome: z.string(),
  papel: PapelOperador,
});
export type Operador = z.infer<typeof Operador>;

export const PedidoMatricula = z.object({
  anoLetivo: z.number().int().min(2026).max(2100),
  tipo: z.enum(['MATRICULA', 'REMATRICULA']),
  aluno: Aluno,
  contratante: Responsavel,
  mae: Responsavel.optional(),
  responsavelFinanceiro: Responsavel,
  servicos: ServicosContratados,
  formaPagamentoMatricula: FormaPagamentoMatricula,
  descontoExcepcionalPct: z.number().min(0).max(100).default(0),
  justificativaDesconto: z.string().optional(),
  consentimentos: z.array(EventoConsentimento).default([]),
  operador: Operador,
});
export type PedidoMatricula = z.infer<typeof PedidoMatricula>;

/* ------------------------------ Utilidades ------------------------------ */

export function validaCPF(v: string): boolean {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (fim: number) => {
    let s = 0;
    for (let i = 0; i < fim; i++) s += Number(d[i]) * (fim + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export const brl = (n: number) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Arredondamento monetário determinístico (meio para cima, 2 casas). */
export const cent = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
