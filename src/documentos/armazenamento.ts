import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Armazenamento de documentos. Implementação em disco (volume no Docker).
 * A interface é a mesma que um S3 teria: grava por caminho lógico, lê por caminho lógico.
 * O caminho nunca vem do usuário — só do banco, depois de o RLS confirmar a escola.
 */

const RAIZ = resolve(process.env.ARQUIVOS_DIR ?? './arquivos');

function absoluto(caminho: string) {
  const p = resolve(RAIZ, caminho);
  if (!p.startsWith(RAIZ + sep)) throw new Error('caminho fora da raiz de arquivos');
  return p;
}

export async function grava(caminho: string, conteudo: Buffer) {
  const p = absoluto(caminho);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, conteudo, { mode: 0o600 });
}

export const le = (caminho: string) => readFile(absoluto(caminho));
export const caminhoDe = (escolaId: string, matriculaId: string, nome: string) => join(escolaId, matriculaId, nome);
