"""Converte a leitura build a build do SmiteBrain (semana/raw_<role>.txt, feita com leitor_builds.js) em ../builds.json,
o ficheiro que a app carrega para mostrar a build mais usada contra equipas parecidas.
Formato de builds.json:
  I: ids de itens (índices), G: ids de deuses (índices), lido_em, corte
  B: { "<deus>|<Role>|<base|aspeto>": "b1;b2;…" }  cada build "V,starter,relíquia,i1.i2.i3…,e1.e2.e3.e4.e5,dia"
     (números em base 36, índices de I e G; V = 1 vitória; itens por ordem de compra)
  L: { "<deus>|<Role>": [[aspeto, tier, win, pick, jogos], …] }  (lista Master+ / Split by Aspect / Past 2 weeks)"""
import json,re,os,sys,datetime
B=os.path.dirname(os.path.abspath(__file__))
ROLES={"solo":"Solo","jungle":"Jungle","mid":"Mid","support":"Support","carry":"Carry"}
data=json.load(open(os.path.join(B,"app/data.json"),encoding="utf-8"))
key=lambda n:re.sub(r"[^a-z0-9]","",n.lower().replace("’","'"))
NOME={}
for i in data["itens"]: NOME[key(i["nome"])]=i["id"]
for x in data.get("itens_deus",[]):
    for k in ("base","aspeto"):
        v=x.get(k) or {}
        if v.get("nome"): NOME.setdefault(key(v["nome"]),x.get("id") or v.get("id"))
    if x.get("nome") and x.get("id"): NOME.setdefault(key(x["nome"]),x["id"])
DEUS={key(g["nome"]):g["id"] for g in data["deuses"]}
ids={g["id"] for g in data["deuses"]}
b36=lambda n:("0" if n==0 else "".join("0123456789abcdefghijklmnopqrstuvwxyz"[d] for d in (lambda n:[(n//36**k)%36 for k in range(int(__import__('math').log(n,36))+1)][::-1])(n)))
I=[];G=[];iI={};iG={}
def ii(x):
    if x not in iI: iI[x]=len(I); I.append(x)
    return b36(iI[x])
def ig(x):
    if x not in iG: iG[x]=len(G); G.append(x)
    return b36(iG[x])
dia=sys.argv[1] if len(sys.argv)>1 else datetime.date.today().isoformat()
OUT={}; LST={}; semitem={}; semdeus=set(); n=0; corte=None; avisos=[]
for r,R in ROLES.items():
    p=os.path.join(B,"semana","raw_%s.txt"%r)
    if not os.path.exists(p): avisos.append("falta "+r); continue
    t=open(p,encoding="utf-8").read()
    if "#BUILDS" not in t: avisos.append(r+": formato antigo (sem builds individuais)"); continue
    corte=re.search(r"corte (\S+)",t).group(1)
    for l in t.split("#LISTA",1)[1].split("#ITENS",1)[0].strip().split("\n"):
        c=[x.strip() for x in l.split("|")]
        if len(c)<7: continue
        g=c[0].replace("-","_")
        if g in ids: LST.setdefault(g+"|"+R,[]).append([c[2],c[3],float(c[4].rstrip("%") or 0),float(c[5].rstrip("%") or 0),int(c[6] or 0)])
    IT=t.split("#ITENS\n",1)[1].split("\n",1)[0].split("|")
    GN=t.split("#DEUSES_N\n",1)[1].split("\n",1)[0].split("|")
    er=t.split("#ERROS",1)[1].split("#FIM",1)[0].strip()
    if er: avisos.append(R+": "+er)
    def mi(k):
        nm=IT[int(k)]; x=NOME.get(key(nm))
        if not x: semitem[nm]=semitem.get(nm,0)+1; x="x:"+nm if nm else None
        return x
    def md(k):
        nm=GN[int(k)]; x=DEUS.get(key(nm))
        if not x: semdeus.add(nm)
        return x
    AGG=["#ROLE %s corte %s"%(r,corte),"#LISTA",t.split("#LISTA\n",1)[1].split("\n#ITENS",1)[0],"#DEUSES"]
    for blk in t.split("#BUILDS\n",1)[1].split("#ERROS",1)[0].split("## ")[1:]:
        # agregado no formato antigo (pick% e win% por ranhura), para a média por role e o cruzamento com dados
        L0=blk.strip().split("\n"); bs=[(l.split("|")+[""]*6)[:6] for l in L0[1:]]
        if bs:
            S={"ST":{},"R":{},"sl":[{} for _ in range(6)]}; nb=len(bs); nw=sum(1 for b in bs if b[0]=="1")
            def add(o,k,w):
                x=o.setdefault(k,[0,0]); x[0]+=1; x[1]+=w
            for v,its,st,rel,en,d in bs:
                w=1 if v=="1" else 0
                if st!="": add(S["ST"],IT[int(st)],w)
                if rel!="": add(S["R"],IT[int(rel)],w)
                for k,x in enumerate([x for x in its.split(",") if x!=""][:6]): add(S["sl"][k],IT[int(x)],w)
            f=lambda o:"; ".join("%s %s %d"%(k,round(n/nb*100,1),round(w/n*100)) for k,(n,w) in sorted(o.items(),key=lambda z:-z[1][0]))
            AGG.append("## %s | %d | %s | builds\nA: %s\nR: %s\nST: %s\n%s"%(L0[0],nb,round(nw/nb*100,1),L0[0].split()[2],f(S["R"]),f(S["ST"]),"\n".join("S%d: %s"%(k+1,f(o)) for k,o in enumerate(S["sl"]))))
        L=blk.strip().split("\n"); slug,role,asp=L[0].split()
        g=slug.replace("-","_")
        if g not in ids: semdeus.add(slug); continue
        k=g+"|"+R+"|"+("base" if asp=="none" else "aspeto"); arr=[]
        for l in L[1:]:
            v,its,st,rel,en,d=(l.split("|")+[""]*6)[:6]
            # a lâmpada do Aladdin e os mods do Vulcan ocupam a ranhura de consumível, não contam como itens
            its=[mi(x) for x in its.split(",") if x!="" and not re.search(r"Genie's Lamp|\bMod$",IT[int(x)])]; its=[x for x in its if x]
            s=mi(st) if st!="" else None; rr=mi(rel) if rel!="" else None
            en=[md(x) for x in en.split(",") if x!=""]; en=[x for x in en if x]
            if len(its)<1: continue
            arr.append(",".join([v, ii(s) if s else "", ii(rr) if rr else "", ".".join(ii(x) for x in its), ".".join(ig(x) for x in en), d]))
            n+=1
        if arr: OUT[k]=";".join(arr)
    AGG.append("#ERROS "+er+"\n#FIM "+r+"\n"); open(os.path.join(B,"semana","agg_%s.txt"%r),"w",encoding="utf-8").write("\n".join(AGG))
json.dump({"lido_em":dia,"corte":corte,"fonte":"smitebrain.com · Master+ · separador Builds, por aspeto","I":I,"G":G,"B":OUT,"L":LST},
  open(os.path.join(B,"..","builds.json"),"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
print(n,"builds;",len(OUT),"variantes deus/role/aspeto; tamanho",os.path.getsize(os.path.join(B,"..","builds.json"))//1024,"KB")
if semitem: print("itens sem correspondência na app (ficam como itens do deus, sem stats):",sorted(semitem.items(),key=lambda x:-x[1])[:15])
if semdeus: print("deuses sem correspondência:",sorted(semdeus))
for a in avisos: print("aviso:",a)
