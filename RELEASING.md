# Publicar uma nova versão do aplicativo Windows

O aplicativo instalado verifica os GitHub Releases ao iniciar e, depois, a cada seis horas. Quando encontra uma versão nova, pergunta se deseja baixar. Depois do download, pergunta se deseja reiniciar para instalar.

Para publicar uma versão:

1. Atualize a versão em `package.json` e `artifacts/programacao-entrega/package.json`.
2. Faça commit e envie as alterações para o GitHub.
3. Crie e envie uma tag igual à versão do `package.json`, com prefixo `v`. Por exemplo:

   ```powershell
   git tag v1.2.7
   git push origin v1.2.7
   ```

4. A ação **Release Windows app** cria o instalador e publica os arquivos necessários no GitHub Release.

O repositório precisa continuar público para que o atualizador possa acessar os arquivos do release sem token. A versão 1.2.6 é a primeira com o mecanismo de atualização; versões anteriores precisam ser atualizadas uma vez pelo instalador manualmente.
