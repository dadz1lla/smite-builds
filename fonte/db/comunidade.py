"""Transforma os agregados do SmiteBrain num sinal secundário por deus e item.
- n = jogos × pick% (nº aproximado de builds com o item nessa ranhura).
- Viés de ranhura: quem chega à 6ª ranhura já está a ganhar; a win rate média sobe com a ranhura. Esse viés é medido
  em todos os deuses e retirado (lift = win − win do deus − viés da ranhura).
- Encolhimento: lift × n/(n+40), para amostras pequenas não pesarem.
- Itens de tier 1/2 nas ranhuras finais são builds por acabar: ficam de fora do lift."""
import json,os,collections
S=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D=json.load(open(os.path.join(S,"kb_src/casos_teste/smitebrain_slots.json"),encoding="utf-8"))
A=json.load(open(os.path.join(S,"app/data.json"),encoding="utf-8"))
key=lambda n:n.lower().replace("'","").replace("’","").strip()
ID={key(i["nome"]):i for i in A["itens"]}
# itens exclusivos de deuses (bolotas do Ratatoskr) contam como itens finais
for x in A.get("itens_deus",[]): ID.setdefault(key(x["nome"]),{"id":x["id"],"nome":x["nome"],"tier":"tier3"})
K=40
# viés por ranhura (só tier 3)
acc=collections.defaultdict(lambda:[0,0])
for g in D["deuses"].values():
    for k,sl in enumerate(g["slots"]):
        for nome,p,w in sl:
            it=ID.get(key(nome))
            if not it or it["tier"]!="tier3": continue
            n=g["jogos"]*p/100; acc[k][0]+=n*(w-g["win"]); acc[k][1]+=n
bias=[round(acc[k][0]/acc[k][1],2) if acc[k][1] else 0 for k in range(6)]
out={"fonte":D["fonte"],"lido_em":D["lido_em"],"filtro":D["filtro"],"vies_ranhura":bias,"deuses":{}}
def resumo(g):
    its=collections.defaultdict(lambda:{"n":0,"pick":0,"dw":0,"sk":0})
    for k,sl in enumerate(g["slots"]):
        for nome,p,w in sl:
            it=ID.get(key(nome))
            if not it or it["tier"]!="tier3": continue
            n=g["jogos"]*p/100; r=its[it["id"]]; r["n"]+=n; r["pick"]+=p; r["sk"]+=p*(k+1); r["dw"]+=n*(w-g["win"]-bias[k])
    itens={}
    for iid,r in its.items():
        lift=r["dw"]/r["n"] if r["n"] else 0; itens[iid]={"n":round(r["n"]),"pick":round(r["pick"]),"lift":round(lift,1),"lift_s":round(lift*r["n"]/(r["n"]+K),1),"slot":round(r["sk"]/r["pick"],1) if r["pick"] else None}
    def lst(L):
        res=[]
        for nome,p,w in L:
            it=ID.get(key(nome)); n=g["jogos"]*p/100; lift=w-g["win"]
            res.append({"id":it["id"] if it else None,"nome":nome,"pick":p,"win":w,"lift_s":round(lift*n/(n+K),1)})
        return res
    return {"patch":g["patch"],"jogos":g["jogos"],"win":g["win"],"itens":itens,"starters":lst(g["starter"]),"reliquias":lst(g["relic"])}
for gid,g in D["deuses"].items():
    o=resumo(g); o["role"]=g["role"]; o["roles"]=g.get("roles",{g["role"]:1.0})
    o["por_role"]={rl:resumo(x) for rl,x in g.get("por_role",{}).items() if x["jogos"]>=1}
    out["deuses"][gid]=o
json.dump(out,open(os.path.join(S,"app/comunidade.json"),"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
print("viés por ranhura",bias)
for gid in ["thor","bacchus","geb"]:
    print(gid,sorted([(v["lift_s"],k,v["pick"]) for k,v in out["deuses"][gid]["itens"].items()],reverse=True)[:6])
