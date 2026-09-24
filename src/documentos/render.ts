import { chromium, type Browser } from 'playwright';
import { hashDocumento } from '../ledger/hash.js';
import { contratoHtml, requerimentoHtml, type DadosDocumento } from './templates.js';

/**
 * HTML → PDF com um único Chromium reaproveitado e concorrência limitada.
 * Subir um navegador por documento derruba a máquina no pico da rematrícula.
 */

let navegador: Promise<Browser> | null = null;
const LIMITE = Number(process.env.PDF_CONCORRENCIA ?? 2);
let emUso = 0;
const fila: (() => void)[] = [];

function obtem(): Promise<Browser> {
  if (!navegador) {
    navegador = chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    navegador.then((b) => b.on('disconnected', () => { navegador = null; }));
  }
  return navegador;
}

async function vaga<T>(fn: () => Promise<T>): Promise<T> {
  if (emUso >= LIMITE) await new Promise<void>((ok) => fila.push(ok));
  emUso++;
  try { return await fn(); } finally { emUso--; fila.shift()?.(); }
}

export interface Pdf { nome: string; buffer: Buffer; sha256: string; bytes: number }

async function renderiza(html: string, nome: string): Promise<Pdf> {
  return vaga(async () => {
    const pagina = await (await obtem()).newPage();
    try {
      await pagina.setContent(html, { waitUntil: 'load' });
      const buffer = await pagina.pdf({ format: 'A4', printBackground: true });
      return { nome, buffer, sha256: hashDocumento(buffer), bytes: buffer.length };
    } finally {
      await pagina.close();
    }
  });
}

export async function geraDocumentos(d: DadosDocumento) {
  const [requerimento, contrato] = await Promise.all([
    renderiza(requerimentoHtml(d), `requerimento-${d.matriculaId}.pdf`),
    renderiza(contratoHtml(d), `contrato-${d.matriculaId}.pdf`),
  ]);
  return { requerimento, contrato };
}

export async function encerraRender() {
  if (navegador) await (await navegador).close().catch(() => {});
}
