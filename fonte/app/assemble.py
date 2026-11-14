import os,json
D=os.path.dirname(os.path.abspath(__file__))
t=open(os.path.join(D,"page_template.html"),encoding="utf-8").read()
data=open(os.path.join(D,"data.json"),encoding="utf-8").read().replace("</","<\\/")
eng=open(os.path.join(D,"engine.js"),encoding="utf-8").read()
an=open(os.path.join(D,"analise.json"),encoding="utf-8").read().replace("</","<\\/")
# Dados como JSON (não como código): o browser lê JSON muito mais depressa. A análise antiga só é lida quando é precisa.
dj=json.loads(data.replace("<\\/","</"))
for g in (dj.get("comunidade") or {}).get("deuses",{}).values():  # "lift" (sem suavizar) não é usado pelo motor; "lift_s" sim
    def tira(x):
        if isinstance(x,dict):
            x.pop("lift",None); [tira(v) for v in x.values()]
        elif isinstance(x,list): [tira(v) for v in x]
    tira(g)
data=json.dumps(dj,ensure_ascii=False,separators=(",",":")).replace("</","<\\/")
t=t.replace("<script>/*DATA*/</script>",'<script type="application/json" id="d-data">'+data+'</script><script>window.SMITE_DATA=JSON.parse(document.getElementById("d-data").textContent)</script>').replace("<script>/*ENGINE*/</script>",
  '<script type="application/json" id="d-an">'+an+'</script><script>(function(){let A;Object.defineProperty(window,"SMITE_ANALISE",{get(){if(A===undefined){try{A=JSON.parse(document.getElementById("d-an").textContent)}catch(e){A=null}}return A}})})()</script><script>'+eng+"</script>")
open(os.path.join(D,"smite2_build_analyst.html"),"w",encoding="utf-8").write(t); print(len(t))
