# M4 Log Visualizer

Aplicacao web standalone para visualizar logs do Meta4, localizar textos e separar SQLs Oracle com os resultados retornados no arquivo.

A aplicacao nao precisa de servidor nem Node.js para uso normal. Ela roda inteiramente no navegador e le os logs selecionados pelo usuario.

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

Por seguranca, navegadores nao permitem que uma pagina leia automaticamente arquivos de `C:\ProgramData`. Por isso, na versao standalone, os arquivos precisam ser escolhidos na tela.

## Publicar no GitHub Pages

1. Suba o repositorio para o GitHub.
2. Abra `Settings > Pages`.
3. Em `Build and deployment`, escolha `Deploy from a branch`.
4. Selecione a branch e a pasta `/docs`.
5. Salve.

Os arquivos necessarios para distribuicao standalone estao em:

```text
docs/index.html
docs/app.js
docs/styles.css
```

## Recursos

- Funciona diretamente no GitHub Pages.
- Nao depende de backend, servidor local ou Node.js.
- Aceita selecao ou arrastar-e-soltar dos arquivos `.txt`.
- Lista cada bloco `Execute Real Stmt` encontrado nos logs.
- Mostra objeto Meta4, node, arquivo, data, organizacao, tempo de execucao e quantidade de linhas.
- Extrai o `Execute Stmt` como SQL Oracle copiavel.
- Mostra SQL com coloracao e quebra de linha.
- Exibe as linhas retornadas pelo log em tabela navegavel.
- Procura por objeto, texto SQL, metadados e valores retornados.
