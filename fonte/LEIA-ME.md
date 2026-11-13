# Atualização semanal dos dados (SmiteBrain → app)

Feita todas as semanas pela tarefa agendada "SMITE Builds: atualização semanal". Tudo o que é preciso está nesta pasta.

## 1. Ler o SmiteBrain (browser integrado da app Claude, no computador do Micael)
Para cada role, por esta ordem: `solo`, `jungle`, `mid`, `support`, `carry`:
1. Abrir `https://smitebrain.com/gods?division=master&splitByAspect=true&time=2w&role=<role>`
   (página "gods" com Division = Master+, Split by Aspect ligado, Time Range = Past 2 weeks, e o role).
   Se aparecer o aviso de cookies, carregar em "Do not consent".
2. Correr o conteúdo de `fonte/leitor.js` na página (javascript_tool), precedido de `await new Promise(r=>setTimeout(r,2500));`.
   O leitor lê a lista do role e depois abre cada deus nesse role com Past 2 weeks e lê a página toda
   (cabeçalho, Aspects, Relics, Starters e as 6 ranhuras do Core, com pick% e win% de cada item). Corre em segundo plano.
3. Esperar até `window.__SB.feito === true` (ver o progresso com `__SB.estado`; esperar com `await` até ~40 s por chamada).
4. Pedir o texto com `__SB.texto() + "\n".repeat(0)` — o resultado é grande e fica gravado num ficheiro em
   `tool-results/`; tirar o texto desse ficheiro com `jq -r '.[0].text'` (ou python) e gravá-lo em
   `fonte/semana/raw_<role>.txt`, sem o ler para a conversa. Confirmar que acaba em `#FIM <role>`.

## 2. Reconstruir a app
`bash fonte/atualizar.sh AAAA-MM-DD` (data do dia). Faz: converter.py → db/comunidade.py → juntar.py → app/analise.js →
app/assemble.py → `index.html` e `sw.js` na raiz (a cache muda de versão, os telemóveis atualizam sozinhos).

## 3. Verificar e publicar
- O resumo do converter.py mostra quantos deuses/pares leu; não publicar se tiver muito menos pares do que na semana anterior
  (ver `git log`) ou se algum role faltar.
- Abrir o `index.html` num browser headless (Playwright) e confirmar que uma recomendação corre sem erros.
- `git add -A && git commit -m "Dados SmiteBrain de AAAA-MM-DD" && git push origin main`.

## Estado em 2026-11-13 (a continuar)
- O Micael quer que cada **aspeto** seja lido à parte (o mesmo deus com e sem aspeto pode ter builds diferentes).
  A lista `gods?division=master&splitByAspect=true&time=2w&role=<role>` mostra uma linha por deus+aspeto, mas as duas linhas
  apontam para a mesma página `/gods/<deus>?role=<role>`, que junta os itens com e sem aspeto e não tem filtro de divisão.
  O separador Builds (`/gods/<deus>/builds/<role>?aspect=<aspeto|none>`, Rank Master+) filtra por aspeto, mas mostra builds
  individuais. Falta o Micael mostrar o caminho certo no site (ele pediu para abrir "o Thor sem aspeto" a partir da lista Solo).
- `semana/raw_solo.txt` foi lido da página do deus (aspeto e base juntos) e serve só de teste; não publicar com ele.
- engine.js (fonte/app): core = frequência primeiro (pick/10) e win rate só a desempatar (±3); itens exclusivos do deus podem ser core;
  starter dos dados aceite se ≥15% de pick nesse role. Ainda não está no index.html publicado.
