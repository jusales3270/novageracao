import { CanalImagem, type PedidoMatricula } from '../src/dominio/tipos.js';

const AGORA = '2026-08-22T13:00:00.000Z';

const consentimentoTotal = (nome: string, cpf: string, exceto: string[] = []) =>
  CanalImagem.options.map((canal) => ({
    canal,
    concedido: !exceto.includes(canal),
    em: AGORA,
    porCpf: cpf,
    porNome: nome,
    canalColeta: 'REQUERIMENTO' as const,
  }));

/** Caso feliz: Alfa I integral, rematrícula, tudo conforme. */
export const PEDIDO_OK: PedidoMatricula = {
  anoLetivo: 2027,
  tipo: 'REMATRICULA',
  aluno: {
    nome: 'Helena Braga Fontoura',
    nascimento: '2021-04-17',
    endereco: 'Rua Paula Souza, 412',
    bairro: 'Vila Nova',
    cidade: 'Itu',
    cep: '13301-140',
    irmaos: ['Miguel, 7 anos'],
    ficha: {
      usoContinuoMedicamento: false,
      alergico: true,
      qualAlergia: 'Amendoim e castanhas',
      intoleranciaAlimentar: 'Lactose (leve)',
      convenio: 'Unimed Itu',
      antitermicoAutorizado: 'Dipirona gotas, conforme receituário anexo',
      prescricaoAnexada: true,
      contatoEmergenciaNome: 'Sônia Braga Fontoura (avó)',
      contatoEmergenciaFone: '11987654321',
    },
    autorizadosRetirada: [
      { nome: 'Sônia Braga Fontoura', telefone: '11987654321', vinculo: 'Avó materna' },
      { nome: 'Marcos Fontoura', telefone: '11991234567', vinculo: 'Tio' },
    ],
  },
  contratante: {
    nome: 'Rodrigo Fontoura Alves',
    cpf: '390.533.447-05',
    email: 'rodrigo.fontoura@exemplo.com.br',
    telefone: '11988776655',
    profissao: 'Engenheiro',
  },
  mae: {
    nome: 'Carolina Braga Fontoura',
    cpf: '111.444.777-35',
    email: 'carolina.braga@exemplo.com.br',
    telefone: '11988112233',
    profissao: 'Fisioterapeuta',
  },
  responsavelFinanceiro: {
    nome: 'Carolina Braga Fontoura',
    cpf: '111.444.777-35',
    email: 'carolina.braga@exemplo.com.br',
    telefone: '11988112233',
  },
  servicos: {
    turma: 'ALFA_I',
    periodo: 'INTEGRAL',
    alimentacao: 'ALMOCO',
    fraldario: 'NENHUM',
    horaAdicionalDiasMes: 0,
  },
  formaPagamentoMatricula: 'AVISTA_ATE_31_08',
  descontoExcepcionalPct: 0,
  consentimentos: consentimentoTotal('Rodrigo Fontoura Alves', '39053344705', ['REDES_SOCIAIS']),
  operador: { nome: 'Vanessa Prado', papel: 'SECRETARIA' },
};

/** Caso bloqueado: berçário integral (A-01) + alimentação dupla (A-02). */
export const PEDIDO_BERCARIO: PedidoMatricula = {
  ...PEDIDO_OK,
  tipo: 'MATRICULA',
  aluno: {
    ...PEDIDO_OK.aluno,
    nome: 'Theo Marques Ribeiro',
    nascimento: '2026-01-09',
    ficha: { ...PEDIDO_OK.aluno.ficha, alergico: false, qualAlergia: undefined },
  },
  servicos: {
    turma: 'BERCARIO',
    periodo: 'INTEGRAL',
    alimentacao: 'ALMOCO_JANTAR',
    fraldario: 'INTEGRAL',
    horaAdicionalDiasMes: 4,
  },
  formaPagamentoMatricula: 'CARTAO_3X',
};

/** Caso bloqueado: desconto de 18% concedido pela secretaria (A-08). */
export const PEDIDO_DESCONTO: PedidoMatricula = {
  ...PEDIDO_OK,
  aluno: { ...PEDIDO_OK.aluno, nome: 'Bento Siqueira Lopes' },
  servicos: { ...PEDIDO_OK.servicos, turma: 'JARDIM', periodo: 'MEIO', alimentacao: 'NENHUMA' },
  descontoExcepcionalPct: 18,
  justificativaDesconto: 'Segundo irmão na escola',
  operador: { nome: 'Vanessa Prado', papel: 'SECRETARIA' },
};
