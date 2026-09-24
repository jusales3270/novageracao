import { CanalImagem, ROTULO_CANAL, type EventoConsentimento } from '../dominio/tipos.js';

/**
 * Consentimento de imagem — Cláusula 16ª.
 *
 * O requerimento atual resolve isso com um par de caixas "sim/não" para
 * site e redes sociais em bloco. A cláusula exige autorização específica,
 * destacada, facultativa e REVOGÁVEL. Revogável significa série temporal
 * de eventos, não coluna booleana: precisa responder "esta foto podia ser
 * publicada naquela data?", não apenas "pode hoje?".
 */

export interface EstadoCanal {
  canal: CanalImagem;
  rotulo: string;
  concedido: boolean;
  desde: string | null;
  porNome: string | null;
}

export class RegistroConsentimento {
  private eventos: EventoConsentimento[] = [];

  constructor(private readonly matriculaId: string) {}

  registrar(ev: EventoConsentimento) {
    this.eventos.push(ev);
  }

  /** Estado em uma data — é isto que responde "podia publicar naquele dia?". */
  estadoEm(quando: string = new Date().toISOString()): EstadoCanal[] {
    return CanalImagem.options.map((canal) => {
      const ultimo = this.eventos
        .filter((e) => e.canal === canal && e.em <= quando)
        .sort((a, b) => a.em.localeCompare(b.em))
        .at(-1);
      return {
        canal,
        rotulo: ROTULO_CANAL[canal],
        concedido: ultimo?.concedido ?? false,
        desde: ultimo?.em ?? null,
        porNome: ultimo?.porNome ?? null,
      };
    });
  }

  /**
   * Fail-closed: sem evento explícito de concessão, a resposta é NÃO.
   * Ausência de decisão nunca vira autorização.
   */
  podePublicar(canal: CanalImagem, quando?: string): boolean {
    return this.estadoEm(quando).find((e) => e.canal === canal)?.concedido ?? false;
  }

  historico() {
    return [...this.eventos].sort((a, b) => a.em.localeCompare(b.em));
  }
}
