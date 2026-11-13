"""Põe a nova comunidade.json dentro de app/data.json (com os aspetos lidos na lista Master+ de cada role)."""
import json,os
B=os.path.dirname(os.path.abspath(__file__))
D=json.load(open(os.path.join(B,"app/data.json"),encoding="utf-8"))
C=json.load(open(os.path.join(B,"app/comunidade.json"),encoding="utf-8"))
S=json.load(open(os.path.join(B,"kb_src/casos_teste/smitebrain_slots.json"),encoding="utf-8"))["deuses"]
for g,c in C["deuses"].items():
    for r,x in c.get("por_role",{}).items():
        src=S.get(g,{}).get("por_role",{}).get(r,{})
        if src.get("aspetos"): x["aspetos"]=src["aspetos"]
        if src.get("aspetos_pagina"): x["aspetos_pagina"]=src["aspetos_pagina"]
D["comunidade"]=C
json.dump(D,open(os.path.join(B,"app/data.json"),"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
print("data.json atualizado:",len(C["deuses"]),"deuses com dados de jogo, lido em",C["lido_em"])
