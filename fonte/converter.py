"""Converte a leitura semanal do SmiteBrain (semana/raw_<role>.txt, feita com leitor_builds.js) no formato do motor
(kb_src/casos_teste/smitebrain_slots.json).
Leitura: lista gods em Master+ / Split by Aspect / Past 2 weeks (deuses e aspetos jogados no role) e, para cada deus e
aspeto, o separador Builds com Rank Master+ e filtro de aspeto, a carregar builds até 14 dias atrás.
Cada deus/role fica com: por_aspeto {base, aspeto} e por_role (as duas versões juntas, pesadas pelos jogos)."""
import json,re,os,sys,datetime
B=os.path.dirname(os.path.abspath(__file__))
ROLES={"solo":"Solo","jungle":"Jungle","mid":"Mid","support":"Support","carry":"Carry"}
FIX={"Pendulum of The Ages":"Pendulum of the Ages","Spear Of The Magus":"Spear of the Magus","Bracer of The Abyss":"Bracer of the Abyss"}
def N(a):
    a=re.sub(r"\s+"," ",a.strip()); return FIX.get(a,a)
def P(s):
    out=[]
    for x in (s or "").split(";"):
        m=re.match(r"(.+?)\s+([\d.]+)\s+([\d.]+)$",x.strip())
        if m and m.group(1).strip(): out.append([N(m.group(1)),float(m.group(2)),float(m.group(3))])
    return out
def num(x):
    try: return float(str(x).replace(",","").replace("%",""))
    except: return None
def juntar(vs):
    """junta variantes (listas de [nome,pick%,win%]) pesadas pelos jogos"""
    J=sum(v["jogos"] for v in vs)
    def mix(get):
        acc={}
        for v in vs:
            for n,p,w in get(v):
                a=acc.setdefault(n,[0,0]); k=v["jogos"]*p/100; a[0]+=k; a[1]+=k*w
        return sorted([[n,round(a[0]/J*100,1),round(a[1]/a[0]) if a[0] else 0] for n,a in acc.items()],key=lambda x:-x[1])
    return dict(jogos=J,win=round(sum(v["jogos"]*v["win"] for v in vs)/J,1),starter=mix(lambda v:v["starter"]),relic=mix(lambda v:v["relic"]),
        slots=[mix(lambda v,i=i:v["slots"][i]) for i in range(6)],parcial=False)
data=json.load(open(os.path.join(B,"app/data.json"),encoding="utf-8"))
ids={g["id"] for g in data["deuses"]}
gid=lambda slug:(slug.replace("-","_") if slug.replace("-","_") in ids else None)
dia=sys.argv[1] if len(sys.argv)>1 else datetime.date.today().isoformat()
V={}; listas={}; desconhecidos=set(); avisos=[]
for r,R in ROLES.items():
    p=os.path.join(B,"semana","agg_%s.txt"%r)   # gerado por builds_conv.py a partir das builds individuais
    if not os.path.exists(p): p=os.path.join(B,"semana","raw_%s.txt"%r)
    if not os.path.exists(p): avisos.append("falta "+r); continue
    t=open(p,encoding="utf-8").read()
    corte=re.search(r"corte (\S+)",t).group(1)
    for l in t.split("#LISTA",1)[1].split("#DEUSES",1)[0].strip().split("\n"):
        c=[x.strip() for x in l.split("|")]
        if len(c)<7: continue
        g=gid(c[0])
        if not g: desconhecidos.add(c[0]); continue
        listas.setdefault(g,{}).setdefault(R,[]).append({"aspeto":c[2],"tier":c[3],"win":num(c[4]),"pick":num(c[5]),"jogos":int(num(c[6]) or 0)})
    er=t.split("#ERROS",1)[1].split("#FIM",1)[0].strip()
    if er: avisos.append(R+": "+er)
    for blk in t.split("#DEUSES",1)[1].split("#ERROS",1)[0].split("## ")[1:]:
        L=blk.strip().split("\n")
        m=re.match(r"(\S+) (\w+) (\S+) \| (\d+) \| ([\d.]+) \| (.*)",L[0])
        if not m: continue
        g=gid(m.group(1))
        if not g: desconhecidos.add(m.group(1)); continue
        d={}
        for l in L[1:]:
            if ":" in l: k,v=l.split(":",1); d[k.strip()]=v.strip()
        var="base" if m.group(3)=="none" else "aspeto"
        V.setdefault(g,{}).setdefault(R,{})[var]=dict(patch="Master+ · %s a %s"%(corte,dia),jogos=int(m.group(4)),win=float(m.group(5)),
            aspeto_nome=d.get("A",""),starter=P(d.get("ST")),relic=P(d.get("R")),slots=[P(d.get("S%d"%i)) for i in range(1,7)],
            parcial=False,leitura=m.group(6))
out={}
for g,pr in V.items():
    por_role={}
    for R,vs in pr.items():
        x=juntar(list(vs.values())); x["patch"]=next(iter(vs.values()))["patch"]; x["aspetos"]=listas.get(g,{}).get(R,[]); por_role[R]=x
    tot=sum(x["jogos"] for x in por_role.values()) or 1
    main=max(por_role,key=lambda k:por_role[k]["jogos"])
    top=dict(por_role[main]); top["role"]=main; top["roles"]={k:round(v["jogos"]/tot,2) for k,v in por_role.items()}
    top["por_role"]=por_role; top["por_aspeto"]=pr
    out[g]=top
json.dump({"fonte":"smitebrain.com","lido_em":dia,"filtro":"Master+, últimas 2 semanas, separado por aspeto (lista gods + separador Builds)",
  "estatuto":"dados de jogo de terceiros; não verificados; sinal para os itens core","deuses":out},
  open(os.path.join(B,"kb_src/casos_teste/smitebrain_slots.json"),"w",encoding="utf-8"),ensure_ascii=False,indent=0)
nv=sum(len(v) for p in V.values() for v in p.values())
print(len(out),"deuses;",sum(len(v["por_role"]) for v in out.values()),"pares deus/role;",nv,"variantes (com/sem aspeto)")
if desconhecidos: print("slugs sem deus na app:",sorted(desconhecidos))
for a in avisos: print("aviso:",a)
