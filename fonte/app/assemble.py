import os,json
D=os.path.dirname(os.path.abspath(__file__))
t=open(os.path.join(D,"page_template.html"),encoding="utf-8").read()
data=open(os.path.join(D,"data.json"),encoding="utf-8").read().replace("</","<\\/")
eng=open(os.path.join(D,"engine.js"),encoding="utf-8").read()
an=open(os.path.join(D,"analise.json"),encoding="utf-8").read().replace("</","<\\/")
t=t.replace("<script>/*DATA*/</script>","<script>window.SMITE_DATA="+data+";</script>").replace("<script>/*ENGINE*/</script>","<script>window.SMITE_ANALISE="+an+";</script><script>"+eng+"</script>")
open(os.path.join(D,"smite2_build_analyst.html"),"w",encoding="utf-8").write(t); print(len(t))
