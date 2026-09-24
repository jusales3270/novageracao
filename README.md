# Escola Nova Geração — sistema de matrículas

Ciclo **requerimento → contrato → assinatura → arquivo** para a CNG Educação Ltda ME (Itu/SP).
M�dulo 1 do roadmap `SVS/CNG-002`.

```
npm ci
cp .env.example .env            # preencher banco e senha inicial
npm run db:migrate
npm run db:seed
npm run app                     # http://localhost:3000
```

## Doutrina

**O motor decide no servidor.** O navegador desenha o veredito; não o produz. Não existe
tabela de preços nem regra no código da página. Isso não é detalhe de arquitetura: na demo
aprovada o motor rodava no navegador, e bastava o DevTools para trocar o perfil e liberar
um desconto fora de alçada.

**O perfil vem da sessão.** `operador.papel` enviado pelo navegador é descartado e
substituído pelo papel do usuário autenticado. Há teste que envia `DIRECAO` numa sessão de
secretaria e exige que o motor bloqueie mesmo assim.

**Fail-closed.** Qualquer regra bloqueante em aberto impede a emissão. A recusa é gravada
com matrícula, motivo e responsável — recusa também é evidência.

**Fonte única de preço.** A anuidade nunca é digitada: é mensalidade × 12, derivada na
leitura. O campo `anuidade_declarada_legado` existe só para a regra R-01 reconciliar contra
o contrato antigo, e nunca entra em cálculo.

## Isolamento

Dois papéis no banco. `ng_owner` roda migrações; `ng_app` é a aplicação e **não é dona de
nenhuma tabela**, portanto não escapa do RLS. Toda operação abre transação e seta
`app.escola_id`; sem isso, nenhuma linha é visível.

Verificado em teste: usuária de outra escola pedindo o PDF pelo id recebe **404**, não 403 —
o documento não existe para ela. A trilha de outra escola vem com zero eventos.

O ledger é append-only por trigger e `ng_app` não tem `update`/`delete` sobre ele.

## Segurança da superfície

| Proteção | Como |
|---|---|
| Sessão | cookie HttpOnly, SameSite=Strict, Secure; o banco guarda só o sha256 do token |
| Senha | scrypt com parâmetros no próprio hash; hash falso quando o e-mail não existe, para o tempo de resposta não revelar contas |
| Força bruta | 5 tentativas por IP + e-mail em 15 minutos |
| CSRF | mutação exige `Content-Type: application/json` + SameSite=Strict |
| Corpo | teto de 1 MB, com 413 entregue antes de cortar a conexão |
| Documentos | id UUID, exige sessão, `Cache-Control: private, no-store` |
| Webhook | HMAC do Connect obrigatório em produção; processo recusa subir sem `DS_CONNECT_HMAC` |
| Cabeçalhos | CSP, `X-Frame-Options: DENY`, nosniff, HSTS |

## As doze regras

| Regra | Verifica | Achado | Decide |
|---|---|---|---|
| R-01 | Anuidade reconcilia com mensalidade × 12 | A-01 | Direção |
| R-02 | Alimentação inclusa não é cobrada de novo | A-02 | Direção |
| R-03 | Desconto dentro da alçada de quem concede | A-08 | Direção |
| R-04 | Consentimento decidido canal a canal | A-04 | Jurídico |
| R-05 | Medicação autorizada tem prescrição anexada | A-05 | Secretaria |
| R-06 | Duas testemunhas nomeadas com CPF | A-06 | Direção |
| R-07 | Tabela de preços aprovada pela direção | — | Direção |
| R-08 | Ano letivo do pedido bate com o da tabela | A-09 | Secretaria |
| R-09 | Responsável financeiro identificado | — | Secretaria |
| R-10 | Pessoas autorizadas à retirada registradas | — | Secretaria |
| R-11 | Escada de desconto da matrícula é aritmética | A-03 | Direção |
| R-12 | Contrato de tratamento de dados assinado | — | Jurídico |

## Consentimento de imagem

Cláusula 16ª: específico, destacado, facultativo e **revogável**. Modelado como série de
eventos com vigência, nunca coluna booleana — `pode_publicar(matricula, canal, quando)`
responde *"podia publicar naquela data?"*. Sem evento de concessão, a resposta é não.

## Assinatura

Docusign JWT Grant: assertion RS256 → `/oauth/token` → `/oauth/userinfo` → `POST /envelopes`.
Quatro a cinco signatários: contratante, responsável financeiro quando diferente, escola e
duas testemunhas em paralelo. As testemunhas preservam a eficácia executiva do contrato
(CPC art. 784, III).

`DS_MODO=mock` roda o fluxo inteiro sem credenciais. O Connect é idempotente por
`envelopeId:evento:destinatário:horário`.

## Testes

```
npm run test        # 24 · motor, fixtures congeladas dos números reais da escola
npm run test:e2e    # 41 · servidor real + Postgres real + navegador real
npm run test:tudo
```

Os de integração sobem o servidor conectado ao banco como `ng_app` e atacam: sessão forjada,
perfil forjado, documento de outra escola, webhook sem HMAC, reenvio duplicado, corpo gigante,
força bruta. Os de interface dirigem a tela de produção no Chromium.

## Pendências da escola

Nenhuma se resolve com código. Enquanto abertas, o motor bloqueia o que deve bloquear.

| Gap | Pendência | Efeito |
|---|---|---|
| G-01 | Preço do berçário integral: R$ 44.327,28 ou R$ 46.056,33 | R-01 bloqueia essa turma |
| G-02 | Alimentação do berçário: inclusa ou adicional | R-02 bloqueia quando há adicional |
| G-05 | Parecer jurídico sobre consentimento por finalidade | escopo dos cinco canais |
| G-06 | Contrato de operador (LGPD art. 39) assinado | R-12 bloqueia produção |

## Antes de virar produção

1. `AMBIENTE=producao` só depois do G-06 — o motor recusa dado real sem DPA.
2. `DS_MODO=real` com a chave privada vinda do cofre, nunca do `.env`.
3. `DS_CONNECT_HMAC` configurado no Connect e no ambiente.
4. Proxy reverso com TLS; `CONFIA_PROXY=true` somente atrás dele.
5. Trocar a senha do seed no primeiro login.
6. Backup do volume `dados` e do volume `arquivos` — o segundo guarda contrato de menor,
   com prazo de retenção longo.
