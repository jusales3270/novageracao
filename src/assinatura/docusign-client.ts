import { createSign, randomUUID } from 'node:crypto';

/**
 * Cliente Docusign eSignature — JWT Grant (server-to-server).
 *
 * Fluxo, conforme developers.docusign.com:
 *  1. Monta assertion JWT RS256 (iss = integration key, sub = user id,
 *     aud = domínio do OAuth, scope "signature impersonation").
 *  2. POST /oauth/token com grant_type urn:ietf:params:oauth:grant-type:jwt-bearer.
 *  3. GET /oauth/userinfo devolve accountId e base_uri da conta.
 *  4. Chamadas de API em {base_uri}/restapi/v2.1/accounts/{accountId}/...
 *
 * Na primeira execução com um integration key novo, o usuário precisa
 * conceder consentimento uma única vez pela URL de consent (o erro
 * `consent_required` vem com essa instrução).
 */

export interface ConfigDocusign {
  integrationKey: string;
  userId: string;
  /** Chave privada RSA em PEM (par da pública cadastrada no app). */
  privateKeyPem: string;
  /** account-d.docusign.com em demo, account.docusign.com em produção. */
  oauthBase: string;
  scopes?: string[];
  mock?: boolean;
}

export interface Sessao {
  accessToken: string;
  accountId: string;
  baseUri: string;
  expiraEm: number;
}

export class DocusignClient {
  private sessao: Sessao | null = null;

  constructor(private readonly cfg: ConfigDocusign) {}

  get emMock() {
    return this.cfg.mock === true;
  }

  urlConsentimento(redirectUri: string): string {
    const scope = (this.cfg.scopes ?? ['signature', 'impersonation']).join('%20');
    return `https://${this.cfg.oauthBase}/oauth/auth?response_type=code&scope=${scope}&client_id=${this.cfg.integrationKey}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  private montaAssertion(): string {
    const agora = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
      iss: this.cfg.integrationKey,
      sub: this.cfg.userId,
      aud: this.cfg.oauthBase,
      iat: agora,
      exp: agora + 3600,
      scope: (this.cfg.scopes ?? ['signature', 'impersonation']).join(' '),
    };
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const corpo = `${b64(header)}.${b64(claims)}`;
    const assinatura = createSign('RSA-SHA256')
      .update(corpo)
      .sign(this.cfg.privateKeyPem)
      .toString('base64url');
    return `${corpo}.${assinatura}`;
  }

  async autentica(): Promise<Sessao> {
    if (this.sessao && this.sessao.expiraEm > Date.now() + 60_000) return this.sessao;

    if (this.emMock) {
      this.sessao = {
        accessToken: 'mock-token',
        accountId: 'mock-account',
        baseUri: 'https://demo.docusign.net',
        expiraEm: Date.now() + 3_600_000,
      };
      return this.sessao;
    }

    const resp = await fetch(`https://${this.cfg.oauthBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: this.montaAssertion(),
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (txt.includes('consent_required')) {
        throw new Error(
          `Consentimento pendente. Abra uma vez: ${this.urlConsentimento('http://localhost:3000/ds/retorno')}`,
        );
      }
      throw new Error(`Docusign OAuth ${resp.status}: ${txt}`);
    }

    const tok = (await resp.json()) as { access_token: string; expires_in: number };

    const info = await fetch(`https://${this.cfg.oauthBase}/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const perfil = (await info.json()) as {
      accounts: { account_id: string; is_default: boolean; base_uri: string }[];
    };
    const conta = perfil.accounts.find((a) => a.is_default) ?? perfil.accounts[0];
    if (!conta) throw new Error('Nenhuma conta Docusign associada ao usuário.');

    this.sessao = {
      accessToken: tok.access_token,
      accountId: conta.account_id,
      baseUri: conta.base_uri,
      expiraEm: Date.now() + tok.expires_in * 1000,
    };
    return this.sessao;
  }

  async chama<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const s = await this.autentica();
    if (this.emMock) return mock<T>(metodo, caminho, corpo);

    const resp = await fetch(
      `${s.baseUri}/restapi/v2.1/accounts/${s.accountId}${caminho}`,
      {
        method: metodo,
        headers: {
          Authorization: `Bearer ${s.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
      },
    );
    if (!resp.ok) throw new Error(`Docusign ${metodo} ${caminho} → ${resp.status}: ${await resp.text()}`);
    return (await resp.json()) as T;
  }
}

/** Respostas sintéticas para rodar o piloto sem credenciais. */
function mock<T>(metodo: string, caminho: string, corpo?: unknown): T {
  if (metodo === 'POST' && caminho === '/envelopes') {
    const def = corpo as { recipients?: { signers?: unknown[] } };
    return {
      envelopeId: randomUUID(),
      status: 'sent',
      statusDateTime: new Date().toISOString(),
      uri: '/envelopes/mock',
      _mock: { signatarios: def?.recipients?.signers?.length ?? 0 },
    } as T;
  }
  if (metodo === 'GET' && caminho.endsWith('/recipients')) {
    return { signers: [], currentRoutingOrder: '1' } as T;
  }
  return { status: 'mock' } as T;
}
