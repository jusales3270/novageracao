import { createHash } from 'node:crypto';

/** Hash de documento: calculado antes do envio, é o que prova depois que o assinado é o gerado. */
export const hashDocumento = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');
