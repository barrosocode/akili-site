# Consumo no front-end — cobrança PIX familiar

**Data:** 2026-10-06
**Base local:** `http://localhost:8000`
**Escopo:** landing que lista a oferta familiar e o checkout que cria a cobrança e acompanha o pagamento. O webhook da PagBank não é chamado pelo front.

O valor, o QR e o status vêm da API. O cliente envia nome, e-mail, CPF e o UUID do pacote escolhido na lista. Não envia centavos, escola nem tenant. O CPF segue para a PagBank e não volta na resposta.

## O que o front consome

| Método | Path                                 | Auth                   | Uso                                                |
| ------ | ------------------------------------ | ---------------------- | -------------------------------------------------- |
| GET    | `/api/v1/guardian/packages`          | Público, 60/min por IP | Lista só a oferta familiar                         |
| POST   | `/api/v1/billing/pix/charges`        | Público                | Cria a cobrança e devolve o PIX                    |
| GET    | `/api/v1/billing/pix/charges/{uuid}` | Público                | Consulta o status e conclui o cadastro quando pago |

Estorno (`POST /api/v1/billing/pix/charges/{uuid}/refund`) exige Bearer e a permissão `billing.refunds.manage`. Não entra na landing.

A vitrine e a compra são públicas. Não envie `Authorization` nessas chamadas.

## Listar pacotes familiares

`GET /api/v1/guardian/packages`
Limite: 60 consultas por minuto por IP.

```http
GET /api/v1/guardian/packages?offer_audience=family&page=1&per_page=15
Accept: application/json
```

`offer_audience=family` já é o padrão deste path. Enviar o parâmetro deixa a intenção explícita na landing. Não use `GET /api/v1/school/packages`: o padrão de lá é audiência `school`.

O filtro inclui pacote publicado cuja `package_type` é `family` ou cuja versão corrente tem preço `audience=family`. Rascunho e arquivado não entram. Um pacote escolar com preço familiar também aparece, e a cobrança PIX aceita esse mesmo caso.

`per_page` vai de 1 a 100. A página é `page`, começando em 1.

Esta lista não usa o envelope da cobrança. O corpo é `{ "data", "meta" }`:

```json
{
    "data": [
        {
            "uuid": "3869c042-2123-4feb-955e-e5d6381bc5b3",
            "name": "teste pacote",
            "slug": "teste-pacote",
            "description": "\\zxcadf",
            "package_type": "school",
            "status": "published",
            "prices": [
                {
                    "uuid": "…",
                    "audience": "school",
                    "currency": "BRL",
                    "price_cents": 500,
                    "billing_period": "one_time"
                },
                {
                    "uuid": "…",
                    "audience": "family",
                    "currency": "BRL",
                    "price_cents": 500,
                    "billing_period": "one_time"
                }
            ],
            "target_profile": null,
            "skills": [],
            "version": {
                "uuid": "…",
                "version": 1,
                "title": "versão pacote",
                "description": "asdf"
            }
        }
    ],
    "meta": {
        "current_page": 1,
        "last_page": 1,
        "per_page": 15,
        "total": 1
    }
}
```

No card, use `uuid` como `package_uuid` da cobrança. O preço exibido é o mesmo que o checkout vai cobrar:

1. Entre os itens de `prices`, o primeiro com `audience` `family` e `billing_period` `one_time`.
2. Se não houver, o primeiro com `audience` `family`.

Ignore preço `school` no card. `price_cents` é inteiro: `500` é R$ 5,00. A API recalcula o valor na criação da cobrança; o card não envia centavos.

`description` do pacote e `version.description` servem para o texto da landing. `skills` traz habilidades declaradas no pacote e herdadas dos conteúdos.

Lista vazia:

```json
{
    "data": [],
    "meta": {
        "current_page": 1,
        "last_page": 1,
        "per_page": 15,
        "total": 0
    }
}
```

| HTTP | Quando                                      |
| ---- | ------------------------------------------- |
| 429  | Mais de 60 consultas por minuto no mesmo IP |

O 429 sai em `application/problem+json`, no mesmo formato da seção de erros da cobrança.

## Cabeçalhos

```http
Accept: application/json
Content-Type: application/json
```

Listar, criar e consultar não levam `Authorization`. A origem da página precisa estar em `CORS_ALLOWED_ORIGINS` (o padrão local é só `http://localhost:3000`).

## Fluxo da tela

1. A landing chama `GET /api/v1/guardian/packages?offer_audience=family` e monta um card por item de `data`.
2. O usuário escolhe um pacote e informa nome, e-mail e CPF. O `package_uuid` é o `uuid` do card.
3. `POST /api/v1/billing/pix/charges`.
4. Com `201`, guardar `charge.uuid` na memória da tela e mostrar o PIX enquanto `status` for `pending`.
5. Consultar `GET /api/v1/billing/pix/charges/{uuid}` a cada 4 segundos, ou ao voltar o foco da aba. O limite é 30 consultas por minuto por IP.
6. Parar o polling quando o status deixar de ser `pending`, ou quando `pix.expires_at` passar.
7. Em `paid`, avisar que o código de primeiro acesso chega por e-mail. A resposta não traz senha, OTP nem link.

O e-mail só sai se o responsável ainda estiver `invited`. Quem já tem conta ativa não recebe outro convite; a compra mesmo assim fica ligada a esse e-mail.

## Criar cobrança

`POST /api/v1/billing/pix/charges`
Limite: 10 criações por hora para o par e-mail + IP.

```json
{
    "name": "Camila Silva",
    "email": "camila@example.com",
    "cpf": "39053344705",
    "package_uuid": "00000000-0000-4000-8000-000000000001"
}
```

| Campo          | Regra                                                             |
| -------------- | ----------------------------------------------------------------- |
| `name`         | Obrigatório, até 255 caracteres                                   |
| `email`        | Obrigatório, e-mail válido, até 255 caracteres                    |
| `cpf`          | Obrigatório, CPF válido. Máscara é aceita e reduzida a 11 dígitos |
| `package_uuid` | Obrigatório, UUID                                                 |

Sucesso `201`. O recurso fica na chave `charge`:

```json
{
    "status": 201,
    "message": "Cobrança PIX criada com sucesso.",
    "errors": {},
    "charge": {
        "uuid": "3f1c2a40-7b5e-4d1a-9c20-0a1b2c3d4e5f",
        "status": "pending",
        "buyer_name": "Camila Silva",
        "buyer_email": "camila@example.com",
        "amount_cents": 15000,
        "currency": "BRL",
        "package": {
            "uuid": "00000000-0000-4000-8000-000000000001",
            "name": "Pacote Família"
        },
        "pix": {
            "qr_code": "00020126…",
            "qr_code_url": "https://sandbox.api.pagseguro.com/…",
            "expires_at": "2026-10-06T18:15:00-03:00"
        },
        "paid_at": null,
        "refunded_at": null,
        "guardian_uuid": null
    },
    "pagination": null,
    "error_code": null
}
```

`amount_cents` é inteiro. R$ 150,00 chega como `15000`. Exibir `amount_cents / 100` com `currency`.

`pix.qr_code` é o copia-e-cola. `pix.qr_code_url` é o PNG hospedado pela PagBank; pode ser `null`. Use a URL em um `<img>` quando existir e gere o QR no cliente a partir de `qr_code` quando não existir.

`pix.expires_at` vem em ISO 8601 com fuso de São Paulo. O prazo padrão é 30 minutos (`PAGBANK_PIX_TTL_MINUTES`).

## Consultar cobrança

`GET /api/v1/billing/pix/charges/{uuid}`

O `{uuid}` é o `charge.uuid` devolvido na criação, não o id `ORDE_` da PagBank.

A consulta fala com a PagBank e atualiza a compra. Quando o pagamento confirma, a mesma chamada cria ou reusa o tenant familiar, a escola lar e o responsável. Por isso um `paid` pode demorar mais que um `pending`.

Sucesso `200`, mesmo envelope, chave `charge`.

Enquanto `pending`, `pix.qr_code` e `pix.qr_code_url` continuam preenchidos. Em qualquer outro status os dois voltam `null`. Não cachear o copia-e-cola depois que o status muda.

Em `paid`, `paid_at` e `guardian_uuid` passam a vir preenchidos.

## Status na interface

| `charge.status` | O que mostrar                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `pending`       | QR, copia-e-cola e contagem até `pix.expires_at`. Continuar o polling.                         |
| `paid`          | Pagamento confirmado. Orientar a abrir o e-mail e concluir o primeiro acesso. Parar o polling. |
| `expired`       | Prazo do PIX acabou. Oferecer gerar outra cobrança.                                            |
| `cancelled`     | Cobrança cancelada antes do pagamento.                                                         |
| `failed`        | Não foi possível cobrar. Oferecer tentar de novo.                                              |
| `refunded`      | Valor estornado. Não é um estado do checkout.                                                  |

## Erros

Falha não usa o envelope de sucesso. O corpo é `application/problem+json`:

```json
{
    "type": "https://akili.dev/problems/validation-error",
    "title": "Erro de validação",
    "status": 422,
    "detail": "Um ou mais campos são inválidos.",
    "instance": "/api/v1/billing/pix/charges",
    "errors": {
        "package_uuid": ["Pacote indisponível para compra."]
    }
}
```

| HTTP | Quando                                                      | O que o front faz                                                                                                                               |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 422  | Campo inválido, pacote indisponível ou sem preço familiar   | Mostrar `errors[campo][0]` no campo. `errors.charge` vale para estorno, não para o checkout.                                                    |
| 404  | UUID de cobrança inexistente                                | Encerrar a tela de pagamento.                                                                                                                   |
| 429  | Limite de criação (10/hora) ou de consulta (30/min)         | Parar o polling e pedir para aguardar.                                                                                                          |
| 502  | PagBank não criou ou não consultou a cobrança               | Mensagem genérica e opção de tentar de novo. `detail`: "Não foi possível criar a cobrança PIX." ou "Não foi possível consultar a cobrança PIX." |
| 503  | Pagamento reconhecido, mas o cadastro do responsável falhou | Manter a tela em espera e consultar de novo. `detail`: "Não foi possível concluir o cadastro do responsável."                                   |

Mensagens de validação que o checkout pode receber:

| Campo          | Mensagem                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `name`         | Informe o nome. / O nome deve ter no máximo 255 caracteres.                                                                      |
| `email`        | Informe o e-mail. / Informe um e-mail válido.                                                                                    |
| `cpf`          | Informe o CPF. / O CPF informado é inválido.                                                                                     |
| `package_uuid` | Informe o pacote. / O pacote informado é inválido. / Pacote indisponível para compra. / Pacote sem preço familiar para cobrança. |

## O que não fazer

- Não montar a vitrine com `GET /api/v1/school/packages` nem com `GET /api/v1/admin/content-packages`. O primeiro lista oferta escolar; o segundo é o CRUD administrativo e inclui rascunho.
- Não mandar preço, `school_id` nem `tenant_id`. A API ignora ou recusa o que não está no contrato.
- Não chamar o webhook `/api/v1/billing/webhooks/pagbank`.
- Não tratar `paid` como login. O acesso seguinte é o código do e-mail na rota `/first-access` do portal do responsável.
- Não guardar nome, e-mail ou copia-e-cola em `localStorage`. O UUID da cobrança fica só no estado da tela de checkout.
