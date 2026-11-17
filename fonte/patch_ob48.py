"""Aplica as notas do OB48 (16/11/2026) a app/data.json. Só altera valores cujo número antigo coincide com o que temos;
o resto fica registado em OB48_NAO_MODELADO (aparece nas notas da app)."""
import json,os
B=os.path.dirname(os.path.abspath(__file__));P=os.path.join(B,"app/data.json")
D=json.load(open(P,encoding="utf-8"));I={i["id"]:i for i in D["itens"]};G={g["id"]:g for g in D["deuses"]}
if D.get("patch")=="OB48": raise SystemExit("já aplicado")
def hab(g,nome,asp=False):
    return [h for h in G[g]["habilidades_aspeto" if asp else "habilidades"] if nome.lower() in (h.get("nome") or "").lower()]
def muda(h,k,de,para):
    assert h.get(k)==de,(h.get("nome"),k,h.get(k),de); h[k]=para
# Itens
e=I["kinetic_cuirass"]["efeitos"][0]; assert e["cada"]==3; e["cada"]=4
c=I["contagion"]; e=c["efeitos"][0]; assert e["hp_self"]==15
e["hp_self"]=8.4; e["nota"]="PRESSUPOSTO: consome ~15 stacks por luta, limitado pelo máximo de 8 (OB48); 0,7% da vida máxima por stack (OB48), área de 4m"
c["notas_tags"]["anti_lifesteal"]="+4 stacks a quem roubar 100 vida (OB48)"
q=I["qins_blade"]; q["efeitos"][0]["tgt_item_por"]={"stats":["ad","str"],"cada":30}
q["notas_tags"]["anti_tank"]="2% vida base + 5% vida de itens, +1% por cada 30 de AD e Força de itens (OB48)"
r=I["soul_reaver"]; r["efeitos"][0]["tgt_item_por"]={"stats":["int"],"cada":80,"mult":4}
r["notas_tags"]["anti_tank"]="1.2% base + 3% itens, +1% por cada 80 de Inteligência de itens (OB48)"
# Deuses
for asp in (False,True):
    for h in hab("hou_yi","ricochet",asp): muda(h,"int",55.0,70.0)
    for h in hab("hou_yi","divebomb",asp): muda(h,"int",40.0,65.0)
h=hab("da_ji","one thousand cuts")[0]; muda(h,"str",35.0,30.0); assert h["buff"]["mitig_pct"]==40.0; h["buff"]["mitig_pct"]=35.0
h=hab("izanami","dark portal",True)[0]; muda(h,"dano",670.0,620.0); muda(h,"int",110.0,100.0)
D["patch"]="OB48"
D.setdefault("notas_patch",{})["OB48"]=["Itens: Contagion, Kinetic Cuirass, Qin's Blade e Soul Reaver atualizados.",
 "Deuses: Hou Yi (escalas de Ricochet e Divebomb), Da Ji (One Thousand Cuts), Izanami com aspeto (Dark Portal) atualizados.",
 "Por modelar (sem números comparáveis aos nossos ou efeitos que o motor não conta): Nox, Baron Samedi (Vivid Gaze), Ix Chel (mana), Khepri (Rising Dawn), Cupid/Cerberus/Horus/Nut/Sol com aspeto, velocidade de ataque e dano base da Izanami com aspeto; Kumbhakarna (deus novo) ainda sem valores."]
json.dump(D,open(P,"w",encoding="utf-8"),ensure_ascii=False,separators=(",",":"))
print("OB48 aplicado")
