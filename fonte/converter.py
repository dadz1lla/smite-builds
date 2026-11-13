"""Converte a leitura semanal do SmiteBrain (semana/raw_<role>.txt, feita com leitor.js) no formato que o motor usa
(kb_src/casos_teste/smitebrain_slots.json). Filtros da leitura: lista em Master+, Split by Aspect e Past 2 weeks;
página de cada deus por role com Past 2 weeks (a página do deus não tem filtro de divisão nem de aspeto)."""
import json,re,os,sys,datetime
B=os.path.dirname(os.path.abspath(__file__))
ROLES={"solo":"Solo","jungle":"Jungle","mid":"Mid","support":"Support","carry":"Carry"}
FIX={"Pendulum of The Ages":"Pendulum of the Ages","Spear Of The Magus":"Spear of the Magus","Bracer of The Abyss":"Bracer of the Abyss"}
def N(a):
    a=re.sub(r"\s+"," ",a.strip())
    return FIX.get(a,a)
def P(s):
    out=[]
    for x in (s or "").split(";"):
        m=re.match(r"(.+?)\s+([\d.]+)\s+([\d.]+)$",x.strip())
        if m: out.append([N(m.group(1)),float(m.group(2)),float(m.group(3))])
    return out
def num(x):
    try: return float(str(x).replace(",","").replace("%",""))
    except: return None
data=json.load(open(os.path.join(B,"app/data.json"),encoding="utf-8"))
ids={g["id"] for g in data["deuses"]}
def gid(slug):
    g=slug.replace("-","_")
    return g if g in ids else None
G={}; listas={}; desconhecidos=set(); erros=[]
dia=sys.argv[1] if len(sys.argv)>1 else datetime.date.today().isoformat()
for r,R in ROLES.items():
    p=os.path.join(B,"semana","raw_%s.txt"%r)
    if not os.path.exists(p): print("falta",p); continue
    t=open(p,encoding="utf-8").read()
    li=t.split("#LISTA",1)[1].split("#DEUSES",1)[0].strip().split("\n")[1:]
    for l in li:
        c=[x.strip() for x in l.split("|")]
        if len(c)<7: continue
        g=gid(c[0])
        if not g: desconhecidos.add(c[0]); continue
        listas.setdefault(g,{}).setdefault(R,[]).append({"aspeto":c[2],"tier":c[3],"win":num(c[4]),"pick":num(c[5]),"jogos":int(num(c[6]) or 0)})
    er=t.split("#ERROS",1)[1].split("#FIM",1)[0].strip() if "#ERROS" in t else ""
    if er: erros.append(R+": "+er)
    for blk in t.split("#DEUSES",1)[1].split("#ERROS",1)[0].split("## ")[1:]:
        L=blk.strip().split("\n"); h=L[0]
        m=re.match(r"(\S+) (\w+) \| ([\d.,]+|null) \| ([\d.]+|null) \| ([\d.]+|null)",h)
        if not m: continue
        g=gid(m.group(1))
        if not g: desconhecidos.add(m.group(1)); continue
        d={}
        for l in L[1:]:
            if ":" in l: k,v=l.split(":",1); d[k.strip()]=v.strip()
        jog=int(num(m.group(3)) or 0)
        if not jog or not d.get("S1"): continue
        G.setdefault(g,{})[R]=dict(patch="2 semanas até "+dia,jogos=jog,win=num(m.group(4)),pick_rate=num(m.group(5)),starter=P(d.get("ST")),relic=P(d.get("R")),
            slots=[P(d.get("S%d"%i)) for i in range(1,7)],aspetos_pagina=P(d.get("A")),aspetos=listas.get(g,{}).get(R,[]),
            parcial=any(not d.get("S%d"%i) for i in range(1,7)))
out={}
for g,pr in G.items():
    tot=sum(x["jogos"] for x in pr.values()) or 1
    main=max(pr,key=lambda k:pr[k]["jogos"])
    top=dict(pr[main]); top["role"]=main; top["roles"]={k:round(v["jogos"]/tot,2) for k,v in pr.items()}
    top["jogos_total"]=tot; top["por_role"]=pr
    out[g]=top
json.dump({"fonte":"smitebrain.com","lido_em":dia,"filtro":"lista: Master+, Split by Aspect, Past 2 weeks; páginas dos deuses: Past 2 weeks, por role",
  "estatuto":"dados de jogo de terceiros; não verificados; sinal para os itens core","deuses":out},
  open(os.path.join(B,"kb_src/casos_teste/smitebrain_slots.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=0)
print(len(out),"deuses;",sum(len(v["por_role"]) for v in out.values()),"pares deus/role")
if desconhecidos: print("slugs sem deus na app:",sorted(desconhecidos))
if erros: print("páginas com problemas:",erros)
