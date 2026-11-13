# Atualização semanal dos dados (SmiteBrain → app)

Feita todas as semanas pela tarefa agendada "SMITE Builds: atualização semanal". Tudo o que é preciso está nesta pasta.

## 1. Ler o SmiteBrain, por aspeto (browser no computador do Micael: navegador integrado da app Claude ou Claude in Chrome)
Método combinado com o Micael a 2026-11-13: **por aspeto**, porque o mesmo deus com e sem aspeto faz builds diferentes
(ex.: Thor Solo sem aspeto começa com Eye of Erebus e Prophetic Cloak; com Thunderstruck, com Devourer's/Shifter's).
A página de cada deus ("Overview") mistura as duas versões e não tem filtro de divisão, por isso usa-se o separador **Builds**,
que tem Rank (Master+ por omissão) e Aspect (None / Aspect of ...), carregando builds até 14 dias atrás.

1. Abrir `https://smitebrain.com/about` num separador (cookies: "Do not consent").
2. Correr o conteúdo de `fonte/leitor_builds.js` (javascript_tool). Lê os 5 roles em cadeia, em segundo plano
   (~20 min por role, ~1 h 40 no total); progresso em `__CADEIA.estado`, fim quando `__CADEIA.feito === true`.
   Esperar com Bash em segundo plano (`sleep 1200`) entre verificações. Se o separador bloquear: fechar, abrir outro
   em smitebrain.com e voltar a correr o leitor com `window.__ROLES = [roles em falta]` — retoma onde ia.
3. No fim, cada role está em `localStorage["sb_raw_<role>"]` (origem smitebrain.com; confirmar que acaba em `#FIM <role>`).
4. Passar os ficheiros para o repositório sem passar pela conversa (o Claude in Chrome corta resultados grandes):
   - na página do SmiteBrain, criar um botão que faz `window.__GH = window.open("https://github.com/dadz1lla/smite-builds/upload/main/fonte/semana","gh_upload")`
     e clicá-lo (o clique abre o separador do GitHub ligado a esta página; o Chrome tem a sessão do GitHub do Micael);
   - no separador do GitHub, pôr um `message` listener que, ao receber `{nome, texto}` de `https://smitebrain.com`, cria
     `new File([texto], nome)`, mete-o no `input[type=file]` com um DataTransfer e dispara `change`;
   - na página do SmiteBrain: `__GH.postMessage({nome:"raw_<role>.txt", texto: localStorage.getItem("sb_raw_<role>")}, "https://github.com")`
     para cada role;
   - no GitHub, escrever o resumo do commit ("Dados SmiteBrain AAAA-MM-DD") e carregar em "Commit changes";
   - do lado do servidor: `git pull` e confirmar que cada `fonte/semana/raw_<role>.txt` acaba em `#FIM <role>`.

## 2. Reconstruir a app
`bash fonte/atualizar.sh AAAA-MM-DD` (data do dia). Faz: converter.py → db/comunidade.py → juntar.py → app/analise.js →
app/assemble.py → `index.html` e `sw.js` na raiz (a cache muda de versão, os telemóveis atualizam sozinhos).

## 3. Verificar e publicar
- O resumo do converter.py mostra quantos deuses/pares leu; não publicar se tiver muito menos pares do que na semana anterior
  (ver `git log`) ou se algum role faltar.
- Abrir o `index.html` num browser headless (Playwright) e confirmar que uma recomendação corre sem erros.
- `git add -A && git commit -m "Dados SmiteBrain de AAAA-MM-DD" && git push origin main`.

## Notas
- A página Overview de cada deus não serve: mistura aspetos e não filtra a divisão.
- O motor usa, para os 3 core e o starter, as builds da versão escolhida (com ou sem aspeto) se tiver ≥20 jogos;
  senão as duas versões juntas; senão a média dos deuses do mesmo tipo de dano nesse role.
