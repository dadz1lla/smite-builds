// Análise por deus/role: a build que os jogadores fazem (dados SmiteBrain por role) faz sentido segundo a simulação
// (kit do deus + efeitos dos itens)? O que dá para melhorar? Só simulação: sem o bónus dos dados.
// Uso: node analise.js [deus]  → escreve analise.json
const d = require("./data.json"); const E = require("./engine.js");
const SL = require("../kb_src/casos_teste/smitebrain_slots.json").deuses;
const e = new E(d); const allowed = E.allowed;
const key = n => n.toLowerCase().replace(/['’]/g, "").trim();
const byName = {}; d.itens.forEach(i => byName[key(i.nome)] = i);
const T3 = d.itens.filter(i => i.tier === "tier3");
const only = process.argv[2];
const out = [];
for (const [god, G] of Object.entries(SL)) {
  if (only && god !== only) continue;
  if (!e.gods[god]) continue;
  for (const [role, R] of Object.entries(G.por_role || {})) {
    const opt = { god, role };
    let ctx; try { ctx = e.ctx(opt); } catch (x) { continue; }
    ctx = Object.assign({}, ctx, { bonusByPath: null });
    // build dos dados: por ranhura, o item tier 3 mais escolhido ainda não usado
    const used = [], info = {};
    R.slots.forEach((sl, k) => {
      const c = sl.map(([n, p, w]) => [byName[key(n)], p, w]).filter(([it]) => it && it.tier === "tier3" && !used.includes(it));
      if (c.length) { used.push(c[0][0]); info[c[0][0].id] = { ranhura: k + 1, pick: c[0][1], win: c[0][2] }; }
    });
    if (used.length < 3) continue;
    // estatística agregada de cada item no role (todas as ranhuras)
    const agg = {}; R.slots.forEach(sl => sl.forEach(([n, p, w]) => { const it = byName[key(n)]; if (!it) return; const a = agg[it.id] = agg[it.id] || { n: 0, w: 0 }; const m = R.jogos * p / 100; a.n += m; a.w += m * w; }));
    Object.values(agg).forEach(a => { a.win = a.n ? Math.round(a.w / a.n) : null; a.n = Math.round(a.n * 10) / 10; delete a.w; });
    // completar até 6: primeiro com os outros itens tier 3 mais usados no role, depois com o melhor da simulação
    Object.entries(agg).sort((a, b) => b[1].n - a[1].n).forEach(([id]) => { const it = e.items[id]; if (used.length < 6 && it && it.tier === "tier3" && !used.includes(it)) { used.push(it); info[id] = { ranhura: "outra", pick: null, win: agg[id].win }; } });
    const rec = e.recommend(opt).builds[0];
    const starter = rec.itens[0];
    const S = (items, p) => e.score([starter].concat(items), p, ctx).val;
    // melhor caminho para a build dos dados
    const ok = (set, it) => !(it.ativo && set.filter(c => c.ativo).length >= 3) && !(it.unico && set.some(c => c.unico === it.unico)) && !set.includes(it);
    let bp = null; e.paths(ctx.kit).forEach(p => { const v = S(used, p); if (!bp || v > bp.v) bp = { p, v }; });
    // melhor build só por simulação (o motor sem dados), no mesmo caminho e no melhor caminho
    const simBest = e.paths(ctx.kit).map(p => e.build(opt, p, ctx)).sort((a, b) => b.score.val - a.score.val)[0];
    const simVal = simBest.score.val;
    const nDados = used.length;
    while (used.length < 6) { let best = null; for (const it of T3) { if (!allowed(it, bp.p, ctx.g) || !ok(used, it)) continue; const v = S(used.concat(it), bp.p); if (!best || v > best.v) best = { v, it }; } if (!best) break; used.push(best.it); info[best.it.id] = { ranhura: "sim" }; }
    bp.v = S(used, bp.p);
    const ok0 = (set, it) => !(it.ativo && set.filter(c => c.ativo).length >= 3) && !(it.unico && set.some(c => c.unico === it.unico)) && !set.includes(it);
    // contribuição de cada item da build dos dados
    const contrib = used.map(it => ({ id: it.id, nome: it.nome, v: (bp.v - S(used.filter(x => x !== it), bp.p)) / bp.v * 100, fora: !allowed(it, bp.p, ctx.g) }));
    // até 2 trocas que mais melhoram (simulação), com o que os dados dizem do item que entra
    let cur = used.slice(), curV = bp.v; const trocas = [];
    for (let t = 0; t < 2; t++) {
      let best = null;
      for (const outIt of cur) for (const inIt of T3) {
        if (!allowed(inIt, bp.p, ctx.g)) continue;
        const set = cur.filter(x => x !== outIt); if (!ok(set, inIt)) continue;
        const v = S(set.concat(inIt), bp.p); if (!best || v > best.v) best = { v, outIt, inIt };
      }
      if (!best || (best.v / curV - 1) * 100 < 1.5) break;
      trocas.push({ sai: best.outIt.nome, entra: best.inIt.nome, ganho: Math.round((best.v / curV - 1) * 1000) / 10, dados_entra: agg[best.inIt.id] || null, dados_sai: agg[best.outIt.id] || null });
      cur = cur.filter(x => x !== best.outIt).concat(best.inIt); curV = best.v;
    }
    const fracos = contrib.filter(c => c.v < 2).map(c => ({ nome: c.nome, contrib: Math.round(c.v * 10) / 10, fora: c.fora }));
    const ev = e.score([starter].concat(used), bp.p, ctx).ev;
    out.push({ god, nome: e.gods[god].nome, role, jogos: R.jogos, win: R.win, patch: R.patch, parcial: !!R.parcial, nDados,
      caminho: bp.p, dados: used.map(i => ({ nome: i.nome, ...info[i.id] })), rel: Math.round(bp.v / simVal * 100),
      sim: simBest.itens.slice(1).map(i => i.nome), simCaminho: simBest.caminho, comuns: used.filter(i => simBest.itens.includes(i)).length,
      motor: rec.itens.slice(1).map(i => i.nome), motorComuns: used.filter(i => rec.itens.includes(i)).length,
      fracos, trocas, depois: Math.round(curV / simVal * 100), T: Math.round(Math.min(ev.T, 30) * 10) / 10 });
  }
}
// padrões sistemáticos: itens que a simulação mete em muitos pares mas quase ninguém compra nesse role → provável sobrevalorização no motor
const ent = {}, sai = {};
out.forEach(x => x.trocas.forEach(t => { const a = ent[t.entra] = ent[t.entra] || { c: 0, d: 0 }; a.c++; if (t.dados_entra && t.dados_entra.n >= 2) a.d++; const b = sai[t.sai] = sai[t.sai] || { c: 0, dw: 0, k: 0 }; b.c++; if (t.dados_sai) { b.dw += t.dados_sai.win - x.win; b.k++; } }));
// uso global de cada item (todos os deuses e roles lidos): builds aproximadas com o item
const uso = {}; Object.values(SL).forEach(G => [G].concat(Object.values(G.por_role || {})).forEach(R => R.slots.forEach(sl => sl.forEach(([n, p]) => { const it = byName[key(n)]; if (it) uso[it.nome] = (uso[it.nome] || 0) + R.jogos * p / 100; }))));
const usoT3 = T3.map(i => uso[i.nome] || 0).sort((a, b) => a - b), med = usoT3[Math.floor(usoT3.length * 0.6)];
const suspeitos = new Set(Object.entries(ent).filter(([n, a]) => a.c >= 6 && (uso[n] || 0) < med).map(([n]) => n));
out.forEach(x => {
  x.trocas.forEach(t => {
    const de = t.dados_entra, ds = t.dados_sai;
    if (suspeitos.has(t.entra)) t.apoio = "suspeita";            // o motor tende a sobrevalorizar este item
    else if (ds && ds.n >= 8 && ds.win >= x.win + 3) t.apoio = "contra";   // o item que sai ganha acima da média do deus neste role
    else if ((de && de.n >= 2 && de.win >= x.win) || (ds && ds.n >= 8 && ds.win <= x.win - 5)) t.apoio = "dados";
    else t.apoio = "sim";
  });
  const boas = x.trocas.filter(t => t.apoio === "dados");
  x.veredicto = x.rel >= 90 ? "coerente" : boas.length ? "melhoravel" : x.trocas.some(t => t.apoio === "sim") ? "divergente" : "coerente_dados";
});
const sist = { sobrevalorizados: [...suspeitos], subvalorizados: Object.entries(sai).filter(([, b]) => b.c >= 5 && b.k && b.dw / b.k >= 3).map(([n, b]) => ({ nome: n, pares: b.c, dwin: Math.round(b.dw / b.k) })) };
require("fs").writeFileSync(__dirname + "/analise.json", JSON.stringify({ gerado: new Date().toISOString().slice(0, 10), sist, pares: out }));
console.log("suspeitos", [...suspeitos].join(", ")); console.log("sub", JSON.stringify(sist.subvalorizados));
const V = {}; out.forEach(x => V[x.veredicto] = (V[x.veredicto] || 0) + 1); console.log(V);
const by = r => out.filter(x => x.role === r);
console.log(out.length, "pares deus/role");
for (const r of ["Solo", "Jungle", "Mid", "Support", "Carry"]) { const L = by(r); if (!L.length) continue; console.log(r, L.length, "rel médio", Math.round(L.reduce((a, x) => a + x.rel, 0) / L.length), "% · com trocas", L.filter(x => x.trocas.length).length); }
if (only) console.log(JSON.stringify(out, null, 1));
