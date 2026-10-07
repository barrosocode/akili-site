# Planejamento da Landing Page com Astro & PagBank (Pix)

Este documento centraliza a arquitetura, o fluxo de dados de segurança e o guia passo a passo para a implementação da Landing Page utilizando **Astro**, focando em alta performance e custo zero de infraestrutura.

---

## 1. Fluxograma de Arquitetura e Segurança (Pix)

O fluxo abaixo garante isolamento total das credenciais do PagBank, mantendo-as seguras na sua API principal, enquanto a Landing Page opera de forma 100% estática na CDN.

```text
[ Cliente / Navegador ]            [ Landing Page (Astro) ]            [ Sua API Principal ]            [ API PagBank ]
         │                                   │                                  │                              │
         │ 1. Preenche dados e clica em      │                                  │                              │
         │    "Gerar Pix"                    │                                  │                              │
         ├──────────────────────────────────>│                                  │                              │
         │                                   │ 2. Dispara fetch(POST) com       │                              │
         │                                   │    dados do cliente              │                              │
         │                                   ├─────────────────────────────────>│                              │
         │                                   │                                  │ 3. Valida dados e gera       │
         │                                   │                                  │    payload seguro de cobrança│
         │                                   │                                  ├─────────────────────────────>│
         │                                   │                                  │                              │
         │                                   │                                  │ 4. Retorna QR Code (Base64)  │
         │                                   │                                  │    e código Copia e Cola     │
         │                                   │                                  │<─────────────────────────────┤
         │                                   │ 5. Retorna JSON com QR Code      │                              │
         │                                   │    e string Copia e Cola         │                              │
         │                                   │<─────────────────────────────────┤                              │
         │ 6. Renderiza dinamicamente o      │                                  │                              │
         │    QR Code e altera botão Copiar  │                                  │                              │
         │<──────────────────────────────────┤                                  │                              │
```

### Detalhes de Segurança:

- **Zero Server-Side na LP:** A Landing Page não processa variáveis de ambiente sensíveis (`PAGBANK_TOKEN`, chaves privadas, etc.).
- **Prevenção de Fraude:** A criação do valor da cobrança e o ID do pedido são consolidados estritamente no ecossistema da sua API principal, evitando que o cliente manipule valores via inspecionar elemento no frontend.

---

## 2. Pré-requisitos do Sistema

Para trabalhar com o Astro, certifique-se de ter instalado em sua máquina:

- **Node.js:** Versão v18.14.1 ou superior.
- **Gerenciador de pacotes:** NPM (nativo do Node), Yarn ou Pnpm.
- **Editor de Código:** VS Code (recomendado instalar a extensão oficial **Astro** para realce de sintaxe).

---

## 3. Passo a Passo de Implementação

### Passo 1: Inicializar o projeto Astro

No seu terminal, navegue até a pasta onde deseja criar o projeto e execute:

```bash
npm create astro@latest
```

_O assistente (Houston) fará algumas perguntas:_

1. **Where should we create your new project?** Escolha o nome da pasta (ex: `./lp-pagamento`).
2. **How would you like to start your new project?** Escolha `Empty` (vazio), já que você possui o HTML pronto.
3. **Do you plan to write TypeScript?** Selecione `No` (ou `Yes`, caso prefira).
4. **Install dependencies?** Selecione `Yes`.
5. **Initialize a new git repository?** Escolha de acordo com sua preferência.

### Passo 2: Estruturar o seu HTML pronto

1. Entre na pasta criada: `cd lp-pagamento`.
2. Abra o projeto no VS Code (`code .`).
3. Vá até a pasta `src/pages/` e abra o arquivo `index.astro`.
4. Substitua todo o conteúdo padrão pelo seu **HTML completo**.
    - _Dica:_ Ao contrário do Next.js, você pode manter atributos como `class` intactos. Certifique-se apenas de que tags que não fecham sozinhas no HTML tradicional estejam devidamente formatadas se optar por usar componentes estritos, mas no `.astro` o HTML padrão é perfeitamente válido.

### Passo 3: Adicionar a lógica de requisição (Fetch do Pix)

No final do seu arquivo `index.astro`, logo antes do fechamento da tag `</body>`, adicione a tag `<script>` nativa do Astro para gerenciar o comportamento do cliente:

```html
<script>
    const form = document.querySelector('#seu-formulario-id');
    const qrCodeImg = document.querySelector('#qrcode-img-id') as HTMLImageElement;
    const copiaColaInput = document.querySelector('#copia-cola-input-id') as HTMLInputElement;
    const resultadoContainer = document.querySelector('#resultado-pix-container');

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Coleta dados do formulário se necessário
      const formData = new FormData(form as HTMLFormElement);
      const data = Object.fromEntries(formData);

      try {
        // Chamada direta para a sua API Principal externa
        const response = await fetch('https://sua-api.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });

        if (!response.ok) throw new Error('Erro ao gerar cobrança.');

        const result = await response.json();

        // Renderização dinâmica dos dados retornados pela sua API
        if (qrCodeImg && copiaColaInput && resultadoContainer) {
          qrCodeImg.src = result.qrCodeBase64; // Ex: "data:image/png;base64,..."
          copiaColaInput.value = result.copiaColaTexto;
          resultadoContainer.classList.remove('hidden'); // Exibe a área do Pix
        }
      } catch (error) {
        alert('Ocorreu um erro ao processar o Pix. Tente novamente.');
        console.error(error);
      }
    });
</script>
```

### Passo 4: Executar o ambiente de desenvolvimento

Para testar a página localmente e validar o comportamento, execute no seu terminal:

```bash
npm run dev
```

Acesse `http://localhost:4321` no seu navegador.

### Passo 5: Build para Produção

Quando a página estiver pronta e integrada, gere os arquivos estáticos puros compilados rodando:

```bash
npm run build
```

O Astro criará uma pasta chamada `dist/`. O conteúdo desta pasta é composto estritamente por **HTML, CSS e JS estáticos**. Você pode hospedar essa pasta diretamente em serviços globais como o [Cloudflare Pages](https://cloudflare.com) ou [Vercel](https://vercel.com) de forma estática com custo zero e proteção DDoS nativa.
