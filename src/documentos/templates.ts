import {
  brl,
  ROTULO_CANAL,
  ROTULO_PERIODO,
  ROTULO_TURMA,
  type PedidoMatricula,
} from '../dominio/tipos.js';
import type { Calculo } from '../motor/calculo.js';
import type { EstadoCanal } from '../consentimento/modelo.js';

/**
 * Templates em HTML → PDF.
 *
 * Escolha deliberada sobre docxtemplater: o contrato revisado tem 23
 * cláusulas e cabe em duas páginas; o requerimento é máscara de
 * preenchimento. Reconstruir custa pouco e elimina a classe inteira de
 * defeitos herdada dos .docx — tabela aninhada, PNG de 154 KB no
 * cabeçalho, resíduo de "exercício 2026" no documento de 2027.
 *
 * As âncoras /ass_contratante/, /ass_financeiro/, /ass_escola/ e
 * /ass_testemunha/ são lidas pelo AutoPlace do Docusign para posicionar
 * as abas de assinatura.
 */

export const LOGO = 'data:image/png;base64,' + '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';

const CSS = `
@page { size: A4; margin: 16mm 15mm 18mm; }
* { box-sizing: border-box; }
body { font: 10pt/1.5 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
h1 { font-size: 14pt; margin: 0 0 2mm; letter-spacing: .02em; }
h2 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .12em;
     margin: 6mm 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #111; }
.cab { border-bottom: 2px solid #1560D0; padding-bottom: 3mm; margin-bottom: 4mm;
       display: flex; justify-content: space-between; align-items: flex-end; }
.marca { font-weight: 700; font-size: 9pt; letter-spacing: .1em; text-transform: uppercase; }
.meta { font: 7.5pt/1.4 "Courier New", monospace; text-align: right; color: #444; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0; }
td, th { border: .4pt solid #999; padding: 1.4mm 2mm; font-size: 8.5pt; vertical-align: top; }
th { background: #f0f0ee; text-align: left; font-weight: 600; font-size: 7.5pt;
     text-transform: uppercase; letter-spacing: .06em; }
.num { text-align: right; font-family: "Courier New", monospace; }
.destaque td { background: #f6f6f4; font-weight: 700; }
.campo { display: inline-block; min-width: 40mm; border-bottom: .4pt solid #111; }
.assinaturas { margin-top: 10mm; page-break-inside: avoid; }
.bloco-ass { margin-bottom: 9mm; }
.ancora { font-size: 7pt; color: #fff; }
.linha-ass { border-bottom: .5pt solid #111; width: 78mm; margin-top: 7mm; }
.rot { font-size: 7.5pt; color: #333; margin-top: 1mm; }
.selo { margin-top: 6mm; padding: 2mm 3mm; border: .4pt solid #999; background: #fafaf8;
        font: 7pt/1.5 "Courier New", monospace; color: #444; }
ol { padding-left: 5mm; } li { margin-bottom: 1.5mm; font-size: 8.5pt; }
.aviso { border-left: 2pt solid #111; padding-left: 3mm; font-size: 8pt; margin: 3mm 0; }
`;

const ROT_ALIMENTACAO: Record<string, string> = {
  NENHUMA: '—',
  ALMOCO: 'Almoço',
  ALMOCO_JANTAR: 'Almoço e jantar',
  ALMOCO_OU_JANTAR: 'Almoço ou jantar',
};
const ROT_FRALDARIO: Record<string, string> = {
  NENHUM: '—',
  MEIO: '½ período',
  INTEGRAL: 'Integral',
  AVULSO: 'Avulso / diário',
};

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

const cpfFmt = (c: string) =>
  c.replace(/\D/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

function cabecalho(titulo: string, meta: string[]) {
  return `<div class="cab">
    <div style="display:flex;gap:5mm;align-items:flex-end">
      <img src="${LOGO}" alt="Nova Geração" style="height:20mm;width:auto">
      <div><h1>${esc(titulo)}</h1></div>
    </div>
    <div class="meta">${meta.map(esc).join('<br>')}</div>
  </div>`;
}

function selo(matriculaId: string, assinaturaLogica: string, geradoEm: string) {
  return `<div class="selo">
    Documento gerado pelo motor determinístico SomaVerso · matrícula ${esc(matriculaId)}<br>
    Veredito ${esc(assinaturaLogica.slice(0, 32))}… · emitido em ${esc(geradoEm)}<br>
    A integridade deste documento é verificável pela cadeia de evidência da escola.
  </div>`;
}

export interface DadosDocumento {
  matriculaId: string;
  pedido: PedidoMatricula;
  calculo: Calculo;
  consentimentos: EstadoCanal[];
  testemunhas: { nome: string; cpf: string }[];
  assinaturaLogica: string;
  geradoEm: string;
  anuidadeDerivada: number;
}

/* ====================== REQUERIMENTO ====================== */

export function requerimentoHtml(d: DadosDocumento): string {
  const { pedido: p, calculo: c } = d;
  const a = p.aluno;
  const f = a.ficha;
  const m = c.mensal;

  const linhaAdicional = (rot: string, v: number) =>
    v > 0 ? `<tr><td>${rot}</td><td class="num">${brl(v)}</td></tr>` : '';

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${cabecalho(`Requerimento de matrícula — ano letivo ${p.anoLetivo}`, [
  `${p.tipo === 'REMATRICULA' ? 'Rematrícula' : 'Matrícula'}`,
  `Nº ${d.matriculaId}`,
  d.geradoEm.slice(0, 10),
])}

<h2>Aluno</h2>
<table>
  <tr><td style="width:55%"><b>Nome</b><br>${esc(a.nome)}</td>
      <td><b>Nascimento</b><br>${esc(a.nascimento)}</td></tr>
  <tr><td colspan="2"><b>Endereço</b><br>${esc(a.endereco)} — ${esc(a.bairro)}, ${esc(a.cidade)} · CEP ${esc(a.cep)}</td></tr>
  ${a.irmaos.length ? `<tr><td colspan="2"><b>Irmãos</b><br>${esc(a.irmaos.join(' | '))}</td></tr>` : ''}
</table>

<h2>Serviços contratados</h2>
<table>
  <tr><th>Turma</th><th>Período</th><th>Alimentação</th><th>Fraldário</th><th>Time Care</th></tr>
  <tr>
    <td>${ROTULO_TURMA[p.servicos.turma]}</td>
    <td>${ROTULO_PERIODO[p.servicos.periodo]}</td>
    <td>${ROT_ALIMENTACAO[p.servicos.alimentacao]}</td>
    <td>${ROT_FRALDARIO[p.servicos.fraldario]}</td>
    <td>${p.servicos.horaAdicionalDiasMes ? `${p.servicos.horaAdicionalDiasMes} dias/mês` : '—'}</td>
  </tr>
</table>

<h2>Composição da mensalidade</h2>
<table>
  <tr><th>Item</th><th style="width:30%;text-align:right">Valor</th></tr>
  <tr><td>Serviço educacional</td><td class="num">${brl(m.servicoEducacional)}</td></tr>
  ${linhaAdicional('Alimentação', m.alimentacao)}
  ${linhaAdicional('Fraldário', m.fraldario)}
  ${linhaAdicional('Hora adicional (Time Care)', m.horaAdicional)}
  ${m.descontoExcepcional > 0 ? `<tr><td>Desconto excepcional (${p.descontoExcepcionalPct}%) — autorizado por ${esc(p.operador.nome)} / ${esc(p.operador.papel)}</td><td class="num">− ${brl(m.descontoExcepcional)}</td></tr>` : ''}
  <tr class="destaque"><td>Mensalidade</td><td class="num">${brl(m.totalCheio)}</td></tr>
  <tr><td>Desconto de pontualidade — pagamento até o dia 05 (Cl. 8ª §6º)</td><td class="num">− ${brl(m.descontoPontualidade)}</td></tr>
  <tr class="destaque"><td>Valor a pagar com pontualidade</td><td class="num">${brl(m.totalComPontualidade)}</td></tr>
</table>
<div class="aviso">Anuidade correspondente ao serviço educacional: <b>${brl(d.anuidadeDerivada)}</b>, equivalente a 12 parcelas de ${brl(m.servicoEducacional)}. Valor derivado da tabela de preços vigente — não digitado separadamente.</div>

<h2>Matrícula</h2>
<table>
  <tr><th>Condição</th><th>Desconto</th><th>Parcelas</th><th style="text-align:right">Valor</th></tr>
  <tr>
    <td>${esc(c.matricula.rotulo)}</td>
    <td>${c.matricula.pct}%</td>
    <td>${c.matricula.parcelas}×</td>
    <td class="num">${brl(c.matricula.valorParcela)}${c.matricula.parcelas > 1 ? ` <span style="color:#666">(total ${brl(c.matricula.total)})</span>` : ''}</td>
  </tr>
</table>

<h2>Ficha pessoal do aluno</h2>
<table>
  <tr><td><b>Uso contínuo de medicamento</b><br>${f.usoContinuoMedicamento ? `Sim — ${esc(f.qualMedicamento)}` : 'Não'}</td>
      <td><b>Alergia</b><br>${f.alergico ? `Sim — ${esc(f.qualAlergia)}` : 'Não'}</td></tr>
  <tr><td><b>Intolerância alimentar</b><br>${esc(f.intoleranciaAlimentar) || 'Não informada'}</td>
      <td><b>Convênio</b><br>${esc(f.convenio) || 'Não informado'}</td></tr>
  <tr><td><b>Antitérmico autorizado</b><br>${esc(f.antitermicoAutorizado) || 'Nenhum'}</td>
      <td><b>Acompanhamento clínico</b><br>${esc(f.acompanhamentoClinico) || 'Não'}</td></tr>
  <tr><td colspan="2"><b>Emergência</b> — ${esc(f.contatoEmergenciaNome)} · ${esc(f.contatoEmergenciaFone)}</td></tr>
</table>
<div class="aviso">Dado pessoal sensível de criança, tratado conforme o art. 14 da Lei nº 13.709/2018 e a Cláusula 15ª do contrato. A autorização de administração de medicamento exige prescrição médica anexa (Cl. 13ª §1º) e o ato de administração é registrado individualmente pela escola.</div>

<h2>Autorização de uso de imagem — por finalidade</h2>
<table>
  <tr><th>Finalidade</th><th style="width:22%">Decisão</th><th style="width:26%">Registrada em</th></tr>
  ${d.consentimentos
    .map(
      (k) =>
        `<tr><td>${esc(ROTULO_CANAL[k.canal])}</td><td><b>${k.concedido ? 'AUTORIZO' : 'NÃO AUTORIZO'}</b></td><td class="num">${esc(k.desde?.slice(0, 10) ?? '—')}</td></tr>`,
    )
    .join('')}
</table>
<div class="aviso">Autorização específica, facultativa e <b>revogável</b> a qualquer tempo (Cl. 16ª), sem prejuízo pedagógico ou contratual. A revogação passa a valer da data do pedido, e a escola mantém registro da vigência de cada decisão.</div>

<h2>Pessoas autorizadas a retirar o aluno</h2>
<table>
  ${
    a.autorizadosRetirada.length
      ? a.autorizadosRetirada
          .map((x) => `<tr><td>${esc(x.nome)}</td><td>${esc(x.vinculo) || '—'}</td><td>${esc(x.telefone)}</td></tr>`)
          .join('')
      : '<tr><td colspan="3">Somente os responsáveis legais.</td></tr>'
  }
</table>
${a.restricaoJudicial ? `<div class="aviso"><b>Restrição judicial informada:</b> ${esc(a.restricaoJudicial)}. Documento comprobatório anexo (Cl. 12ª §1º).</div>` : ''}

<h2>Contratante e responsável financeiro</h2>
<table>
  <tr><td><b>Contratante / responsável legal</b><br>${esc(p.contratante.nome)}<br>CPF ${cpfFmt(p.contratante.cpf)} · ${esc(p.contratante.email)}</td>
      <td><b>Responsável financeiro (emissão da cobrança)</b><br>${esc(p.responsavelFinanceiro.nome)}<br>CPF ${cpfFmt(p.responsavelFinanceiro.cpf)} · ${esc(p.responsavelFinanceiro.email)}</td></tr>
  ${p.mae ? `<tr><td colspan="2"><b>Mãe</b><br>${esc(p.mae.nome)} · CPF ${cpfFmt(p.mae.cpf)} · ${esc(p.mae.email)}</td></tr>` : ''}
</table>

<p style="font-size:8.5pt">Declaro ser responsável pela veracidade das informações deste requerimento e estar ciente do compromisso de apresentar cópia atualizada da carteira de vacinação em até 07 dias úteis a contar de cada alteração.</p>

<div class="assinaturas">
  <div class="bloco-ass">
    <span class="ancora">/ass_contratante/</span>
    <div class="linha-ass"></div>
    <div class="rot">${esc(p.contratante.nome)} — contratante / responsável legal</div>
  </div>
  ${
    p.responsavelFinanceiro.cpf !== p.contratante.cpf
      ? `<div class="bloco-ass">
           <span class="ancora">/ass_financeiro/</span>
           <div class="linha-ass"></div>
           <div class="rot">${esc(p.responsavelFinanceiro.nome)} — responsável financeiro</div>
         </div>`
      : ''
  }
</div>

${selo(d.matriculaId, d.assinaturaLogica, d.geradoEm)}
</body></html>`;
}

/* ======================== CONTRATO ======================== */

export function contratoHtml(d: DadosDocumento): string {
  const { pedido: p, calculo: c } = d;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
${cabecalho(`Contrato de prestação de serviços educacionais — ano letivo ${p.anoLetivo}`, [
  'CNG Educação Ltda ME',
  'CNPJ 07.694.200/0001-30',
  `Nº ${d.matriculaId}`,
])}

<p style="font-size:8.5pt"><b>CONTRATADA:</b> CNG EDUCAÇÃO LTDA ME, CNPJ 07.694.200/0001-30, Rua Dr. José Paula Leite de Barros, 136, Centro, Itu/SP. <b>CONTRATANTES:</b> ${esc(p.contratante.nome)}, CPF ${cpfFmt(p.contratante.cpf)}${p.responsavelFinanceiro.cpf !== p.contratante.cpf ? `, e ${esc(p.responsavelFinanceiro.nome)}, CPF ${cpfFmt(p.responsavelFinanceiro.cpf)}, na condição de responsável financeiro` : ''}. <b>ALUNO(A):</b> ${esc(p.aluno.nome)}, conforme Requerimento de Matrícula anexo, que integra este instrumento para todos os fins.</p>

<h2>Objeto e preço — Cláusulas 2ª e 8ª</h2>
<table>
  <tr><th>Turma</th><th>Período</th><th style="text-align:right">Mensalidade</th><th style="text-align:right">Anuidade</th></tr>
  <tr>
    <td>${ROTULO_TURMA[p.servicos.turma]}</td>
    <td>${ROTULO_PERIODO[p.servicos.periodo]}</td>
    <td class="num">${brl(c.mensal.servicoEducacional)}</td>
    <td class="num">${brl(d.anuidadeDerivada)}</td>
  </tr>
</table>
<div class="aviso">A anuidade corresponde a 12 parcelas iguais da mensalidade indicada. Mensalidade e anuidade derivam da mesma tabela de preços aprovada, sem digitação independente — o que elimina divergência entre este contrato e o requerimento anexo.</div>

<h2>Cláusulas</h2>
<ol>
  <li><b>Legislação aplicável.</b> Constituição Federal, Código Civil, Lei nº 8.078/1990, Lei nº 9.394/1996, Lei nº 9.870/1999, Lei nº 8.069/1990, Lei nº 13.146/2015, Lei nº 13.709/2018 e Lei nº 13.185/2015, quando aplicável.</li>
  <li><b>Documentos integrantes.</b> Integram este contrato o Requerimento de Matrícula, o Regulamento Escolar, o calendário escolar e as autorizações específicas assinadas pelos responsáveis.</li>
  <li><b>Pontualidade.</b> Desconto de ${brl(c.mensal.descontoPontualidade)} sobre a parcela paga até o dia 05 do mês de vencimento, não incidente sobre serviços cobrados separadamente.</li>
  <li><b>Impontualidade.</b> Multa de 2%, juros de 1% ao mês pro rata die e correção pelo IPCA, sem prejuízo da perda do desconto de pontualidade. A inadimplência não autoriza sanção pedagógica, retenção de documentos ou constrangimento.</li>
  <li><b>Cancelamento.</b> Solicitação por escrito com 30 dias de antecedência; durante o aviso prévio os serviços permanecem disponíveis e a parcela correspondente é devida.</li>
  <li><b>Saúde e medicação.</b> A administração de medicamento depende de solicitação escrita e prescrição médica legível com dose, horário e período. Cada ato de administração é registrado individualmente pela escola, com identificação de quem administrou e comunicação aos responsáveis.</li>
  <li><b>Retirada do aluno.</b> Somente pelos responsáveis legais ou pelas pessoas nomeadas no requerimento. Alteração de guarda, poder familiar ou restrição de contato deve ser comunicada com o documento pertinente.</li>
  <li><b>Proteção de dados.</b> Tratamento conforme a Lei nº 13.709/2018, observado o melhor interesse da criança. Canal do titular: secretaria@novageracaoitu.com.br.</li>
  <li><b>Uso de imagem.</b> Autorização específica, destacada, facultativa e revogável por finalidade, registrada no requerimento anexo com data de vigência de cada decisão.</li>
  <li><b>Assinatura eletrônica.</b> Assinado eletronicamente com identificação dos signatários e preservação da integridade do documento, produzindo os efeitos admitidos em lei.</li>
  <li><b>Vigência.</b> Da efetivação da matrícula até a conclusão do ano letivo de ${p.anoLetivo}.</li>
  <li><b>Foro.</b> O definido pela legislação aplicável, especialmente as normas de proteção ao consumidor, podendo as partes optar pelo Foro da Comarca de Itu/SP quando juridicamente admissível.</li>
</ol>

<p style="font-size:8.5pt;margin-top:6mm">Itu, ${esc(dataExtenso(d.geradoEm))}.</p>

<div class="assinaturas">
  <div class="bloco-ass">
    <span class="ancora">/ass_escola/</span>
    <div class="linha-ass"></div>
    <div class="rot">CNG Educação Ltda ME — representante legal</div>
  </div>
  <div class="bloco-ass">
    <span class="ancora">/ass_contratante/</span>
    <div class="linha-ass"></div>
    <div class="rot">${esc(p.contratante.nome)} — contratante / responsável legal</div>
  </div>
  ${
    p.responsavelFinanceiro.cpf !== p.contratante.cpf
      ? `<div class="bloco-ass">
           <span class="ancora">/ass_financeiro/</span>
           <div class="linha-ass"></div>
           <div class="rot">${esc(p.responsavelFinanceiro.nome)} — responsável financeiro</div>
         </div>`
      : ''
  }
  ${d.testemunhas
    .map(
      (t) => `<div class="bloco-ass">
        <span class="ancora">/ass_testemunha/</span>
        <div class="linha-ass"></div>
        <div class="rot">${esc(t.nome)} — testemunha · CPF ${cpfFmt(t.cpf)}</div>
      </div>`,
    )
    .join('')}
</div>
<div class="aviso" style="font-size:7.5pt">As duas testemunhas nomeadas preservam a eficácia executiva deste instrumento (CPC art. 784, III).</div>

${selo(d.matriculaId, d.assinaturaLogica, d.geradoEm)}
</body></html>`;
}

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function dataExtenso(iso: string) {
  const dt = new Date(iso);
  return `${dt.getUTCDate()} de ${MESES[dt.getUTCMonth()]} de ${dt.getUTCFullYear()}`;
}
