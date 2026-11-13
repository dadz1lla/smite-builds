#!/bin/bash
# Atualização semanal: semana/raw_<role>.txt (lidos com leitor.js) -> dados da app -> index.html na raiz do repositório.
# Uso: bash fonte/atualizar.sh AAAA-MM-DD
set -e
cd "$(dirname "$0")"
DIA=${1:-$(date -u +%F)}
python3 converter.py "$DIA"
python3 db/comunidade.py >/dev/null
python3 juntar.py
node app/analise.js >/dev/null
python3 app/assemble.py >/dev/null
python3 - "$DIA" <<'P'
import re,sys,datetime
p='../index.html';old=open(p,encoding='utf-8').read()
head=old[:old.index('<title>')]
body=open('app/smite2_build_analyst.html',encoding='utf-8').read().replace('<meta name="claude:viewport-fit-sides" content="cover">\n','',1)
foot=old[old.rindex('\n<p style="text-align:center'):]
open(p,'w',encoding='utf-8').write(head+body+foot)
sw=open('../sw.js').read();v=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M')
open('../sw.js','w').write(re.sub(r'const V="[^"]+"','const V="smite-builds-'+v+'"',sw))
print("index.html e sw.js atualizados")
P
rm -f app/smite2_build_analyst.html
