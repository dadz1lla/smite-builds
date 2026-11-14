import os,json
D=os.path.dirname(os.path.abspath(__file__))
t=open(os.path.join(D,"page_template.html"),encoding="utf-8").read()
data=open(os.path.join(D,"data.json"),encoding="utf-8").read().replace("</","<\\/")
eng=open(os.path.join(D,"engine.js"),encoding="utf-8").read()
an=open(os.path.join(D,"analise.json"),encoding="utf-8").read().replace("</","<\\/")
# Página leve: só itens e deuses vão dentro da página (para o ecrã aparecer logo). Os dados de jogo agregados ("comunidade") e a
# análise antiga vão para extra.json, carregado em segundo plano (como builds.json) e guardado pelo telemóvel.
dj=json.loads(data.replace("<\\/","</"))
com=dj.pop("comunidade",None)
for g in (com or {}).get("deuses",{}).values():  # "lift" (sem suavizar) não é usado pelo motor; "lift_s" sim
    def tira(x):
        if isinstance(x,dict):
            x.pop("lift",None); [tira(v) for v in x.values()]
        elif isinstance(x,list): [tira(v) for v in x]
    tira(g)
open(os.path.join(D,"..","..","extra.json"),"w",encoding="utf-8").write(json.dumps({"comunidade":com,"analise":json.loads(an)},ensure_ascii=False,separators=(",",":")))
data=json.dumps(dj,ensure_ascii=False,separators=(",",":")).replace("</","<\\/")
t=t.replace("<script>/*DATA*/</script>",'<script type="application/json" id="d-data">'+data+'</script><script>window.SMITE_DATA=JSON.parse(document.getElementById("d-data").textContent)</script>').replace("<script>/*ENGINE*/</script>","<script>"+eng+"</script>")
open(os.path.join(D,"smite2_build_analyst.html"),"w",encoding="utf-8").write(t); print(len(t))
