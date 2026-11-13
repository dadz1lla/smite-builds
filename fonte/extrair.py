"""Tira o texto devolvido pelo leitor (resultado grande do javascript_tool, gravado em tool-results/) para semana/raw_<role>.txt.
Uso: python3 extrair.py <ficheiro tool-results> <role>"""
import sys,json,os
f,role=sys.argv[1],sys.argv[2]
arr=json.load(open(f,encoding="utf-8"))
t=arr[0]["text"] if isinstance(arr,list) else arr
if t.lstrip().startswith('"'): t,_=json.JSONDecoder().raw_decode(t.lstrip())
t=t.split("\n#PAD")[0]
assert ("#ROLE "+role in t[:40] or t.startswith("#LISTA "+role)) and "#FIM "+role in t, "texto incompleto"
p=os.path.join(os.path.dirname(os.path.abspath(__file__)),"semana","raw_%s.txt"%role)
open(p,"w",encoding="utf-8").write(t)
print(p,len(t),"caracteres,",t.count("\n## "),"blocos; erros:",t.split("#ERROS",1)[1].split("\n",1)[0].strip() or "nenhum")
