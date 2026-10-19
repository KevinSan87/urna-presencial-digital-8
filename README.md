# Urna Presencial Digital

Sistema de votação presencial em português, com tela pública (`/`) e painel administrativo (`/admin`). O fluxo do eleitor é: escolher → confirmar → registrar → som → voto confirmado → 5 segundos → próximo eleitor.

## Iniciar

Requisitos: Node.js 20+ e npm/pnpm.

### Windows

Abra o PowerShell dentro da pasta do projeto e execute:

```powershell
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install
pnpm dev
```

Também é possível dar duplo clique em `iniciar-urna-windows.bat`. Ele verifica `node_modules`, executa `pnpm install` quando necessário, inicia o servidor explicitamente em `HOST=0.0.0.0` e `PORT=3000`, abre `http://localhost:3000/` e mostra o endereço LAN para os outros computadores. Não use `pnpm run dev --open`: o argumento `--open` é encaminhado ao servidor Node e não instala dependências nem abre o navegador.

Os scripts já usam `cross-env`, então não é necessário executar `NODE_ENV=development` manualmente. Para produção local:

```powershell
pnpm build
pnpm start
```

```bash
npm install
npm run dev
```

Abra `http://localhost:3000/` para votar no computador servidor. Nos outros computadores da mesma rede, use `http://IP-DO-SERVIDOR:3000/`, por exemplo `http://192.168.137.1:3000/`. O servidor Node escuta em todas as interfaces (`0.0.0.0`); se o endereço LAN não abrir, libere a porta TCP 3000 no Firewall do Windows e confirme que a rede está como **Privada**.

Para liberar a porta automaticamente, clique com o botão direito em `liberar-firewall-urna.bat` e escolha **Executar como administrador**. Depois, inicie `iniciar-urna-windows.bat`. No outro computador, teste primeiro `http://IP-DO-SERVIDOR:3000/api/health`; a resposta esperada é `{"status":"ok"}`.

Login inicial do admin:

- Usuário: `Emilia`
- Senha: `Emilia@123`

## Planilha central para vários notebooks

O projeto não depende do armazenamento do navegador. A votação usa o servidor local como fonte imediata: cada voto é salvo localmente antes da resposta, sem esperar a internet ou o Google Sheets. No `/admin`, o botão **Salvar na planilha** envia os votos pendentes quando você decidir.

A planilha central armazena identidade, grupos e votos sincronizados:

- aba `Configuração`: `name` e `status` (`open` ou `closed`);
- aba `Grupos`: ID, nome, descrição, ativo e `createdAt`;
- aba `Votos`: registros de todos os votos.

1. Abra `google-apps-script/Code.gs` e substitua todo o código atual no Google Apps Script. A versão antiga registra apenas votos e não consegue centralizar grupos.
2. Clique em **Implantar > Gerenciar implantações > Editar**, selecione **Nova versão** e publique o mesmo Web App como você, permitindo acesso a qualquer pessoa com o link.
3. Mantenha a mesma URL `/exec` ou atualize-a em `server/sheets-config.ts`.
4. Faça upload de `google-sheets/urna-presencial-google-sheets-modelo.xlsx` no Google Drive e abra-o com Google Sheets.
5. Distribua o ZIP. A urna registra votos localmente sem atraso. Entre no `/admin` e clique em **Salvar na planilha** para reconciliar a aba `Votos`: votos faltantes são adicionados e votos excedentes ou duplicados são removidos para a planilha ficar igual ao servidor local.

Após esta atualização, substitua novamente o código no Apps Script e publique uma nova versão da implantação. A ação `replaceVotes` é necessária para permitir a reconciliação completa.

Se a aba `Votos` mostrar somente a data e o `voteId`, a implantação está usando o código antigo. Substitua todo o conteúdo por `google-apps-script/Code.gs`, salve e publique uma **nova versão** em **Implantar > Gerenciar implantações > Editar > Nova versão**. O código novo preenche Data, Horário, ID do grupo, Nome do grupo, `createdAt` e `voteId`.

O painel administrativo mostra e grava essa configuração em **Google Sheets**. O histórico externo não é apagado pelo botão de reset local. As imagens escolhidas no `/admin` são salvas em `.data/uploads` no computador que executa o servidor e exibidas pela rota `/uploads/...`; qualquer computador da mesma rede que acessar esse servidor verá as mesmas imagens. Não execute um servidor separado em cada notebook.

O arquivo `google-sheets/urna-presencial-google-sheets-modelo.xlsx` já contém as abas `Votos`, `Configuração`, `Grupos` e `Instruções`. Faça upload dele no Google Drive, abra como Google Sheets e siga a aba `Instruções`.

## Dados

Com `DATABASE_URL` provisionada, o servidor cria e usa as tabelas `voting_config`, `voting_groups` e `voting_votes`. Sem banco disponível, usa `.data/voting-state.json` para que a instalação local continue funcional. A pasta `.data` não deve ser distribuída com resultados de testes.

## Rotas

- `/`: urna pública, sem menu administrativo, contagem ou resultados.
- `/admin`: login, identidade, grupos, controle, resultados e Sheets.
- `/manus-routes.json`: manifesto das rotas.
- `/api/health`: health check.
