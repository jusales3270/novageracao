import { createHmac, timingSafeEqual } from 'node:crypto';
import { comEscola, semEscola } from '../db/pool.js';
import { registra } from '../db/ledger.js';

/**
 * Docusign Connect.
 * - HMAC obrigatório em produção: sem ele, qualquer requisição declararia um contrato assinado.
 * - Idempotente: o Connect reenvia; o mesmo evento entra uma única vez.
 * - A escola é descoberta pelo envelope, nunca pelo corpo da requisição.
 */

export function verificaHmac(corpoCru: string, header: string, segredo: string): boolean {
  if (!segredo || !header) return false;
  const a = Buffer.from(createHmac('sha256', segredo).update(corpoCru, 'utf8').digest('base64'));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface EventoConnect {
  event: string;
  generatedDateTime?: string;
  data: {
    envelopeId: string;
    recipientId?: string;
    envelopeSummary?: {
      status?: string;
      recipients?: { signers?: { recipientId: string; name: string; status: string; signedDateTime?: string }[] };
    };
  };
}

export async function processa(ev: EventoConnect) {
  const envelopeId = ev.data?.envelopeId;
  if (!envelopeId) return { ignorado: 'sem envelopeId' };

  const chave = [envelopeId, ev.event, ev.data.recipientId ?? '-', ev.generatedDateTime ?? '-'].join(':');
  const novo = await semEscola(async (tx) => {
    const r = await tx.query(
      'insert into webhook_evento (chave, corpo) values ($1,$2) on conflict (chave) do nothing',
      [chave, JSON.stringify(ev)]);
    return (r.rowCount ?? 0) > 0;
  });
  if (!novo) return { duplicado: true };

  const escolaId = await semEscola(async (tx) =>
    (await tx.query<{ escola_id: string }>('select escola_id from envelope_indice where envelope_id = $1', [envelopeId]))
      .rows[0]?.escola_id);
  if (!escolaId) return { ignorado: 'envelope desconhecido' };

  return comEscola(escolaId, async (tx) => {
    const env = (await tx.query<{ id: string; matricula_id: string }>(
      'select id, matricula_id from envelope where envelope_id = $1', [envelopeId])).rows[0];
    if (!env) return { ignorado: 'envelope fora da escola' };

    if (ev.event === 'recipient-completed') {
      for (const s of ev.data.envelopeSummary?.recipients?.signers ?? []) {
        if (s.status !== 'completed') continue;
        await tx.query(
          `update envelope_signatario set status = 'assinado', assinado_em = $3
            where envelope_id = $1 and nome = $2 and status <> 'assinado'`,
          [env.id, s.name, s.signedDateTime ?? new Date().toISOString()]);
        await registra(tx, escolaId, env.matricula_id, 'SIGNATARIO_ASSINOU', s.name, { envelopeId });
      }
    } else if (ev.event === 'envelope-completed') {
      await tx.query("update envelope set status = 'completed', concluido_em = now() where id = $1", [env.id]);
      await tx.query("update matricula set status = 'concluida' where id = $1", [env.matricula_id]);
      await registra(tx, escolaId, env.matricula_id, 'ENVELOPE_CONCLUIDO', 'docusign', { envelopeId });
    } else if (ev.event === 'envelope-declined' || ev.event === 'envelope-voided') {
      await tx.query('update envelope set status = $2 where id = $1', [env.id, ev.event.replace('envelope-', '')]);
      await registra(tx, escolaId, env.matricula_id, 'ENVELOPE_' + ev.event.replace('envelope-', '').toUpperCase(), 'docusign', { envelopeId });
    } else {
      await registra(tx, escolaId, env.matricula_id, 'EVENTO_DOCUSIGN', 'docusign', { envelopeId, evento: ev.event });
    }
    return { processado: ev.event, matriculaId: env.matricula_id };
  });
}
