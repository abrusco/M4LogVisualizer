# M4 Log Visualizer

Visualizador de logs Meta4, PeopleNet e Cegid para análise rápida de SQLs Oracle, objetos Meta4 e resultados retornados em arquivos de log.

O M4 Log Visualizer é uma aplicação web standalone para abrir logs de execução, localizar queries Oracle, identificar objetos Meta4 e analisar os resultados retornados sem depender de backend, instalação local complexa ou servidor Node.js. Ele é útil para suporte, desenvolvimento, integração e administração de ambientes Meta4, PeopleNet e Cegid.

## Funcionalidades

- Carrega arquivos de log `.txt` selecionados ou arrastados pelo usuário.
- Identifica blocos `Execute Real Stmt` e `Execute Stmt` encontrados nos logs.
- Mostra objeto Meta4, node, arquivo, data, organização, tempo de execução e quantidade de linhas.
- Extrai o SQL Oracle e permite copiar o texto facilmente.
- Exibe o SQL com destaque visual e formatação para leitura.
- Apresenta as linhas retornadas pelo log em tabela navegável.
- Permite buscar por objeto, SQL, texto e valores retornados.
- Possui filtro por arquivo, SQL físico e ordenação por data.
- Inclui uma tela de configurações para gerenciar objetos ignorados, com persistência no navegador.
- Exibe a versão atual da aplicação na interface.

## Como usar localmente

Abra este arquivo no navegador:

```text
docs/index.html
```

Depois selecione ou arraste os arquivos:

```text
C:\ProgramData\meta4\M4Temp\m4ldb\ldbinsp0_1.txt
C:\ProgramData\meta4\M4Temp\m4ldb\ldbinsp0_2.txt
```

Por segurança, navegadores não permitem que uma página leia automaticamente arquivos de `C:\ProgramData`. Por isso, na versão standalone, os arquivos precisam ser escolhidos na tela.

## Arquivos principais

```text
docs/index.html
docs/app.js
docs/styles.css
docs/version.json
```

## Sobre

Este é um visualizador de logs desenvolvido para facilitar a análise de execuções em ambientes Meta4, PeopleNet e Cegid. Para melhorar a descoberta, o projeto foi descrito com palavras-chave relevantes como: meta4, peoplenet, cegid, visualizador de logs, análise de logs Meta4, SQL Oracle e M4 Log Visualizer.
