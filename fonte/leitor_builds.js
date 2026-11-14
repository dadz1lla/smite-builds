/* Leitor do SmiteBrain build a build (separador Builds, Rank Master+, por aspeto), versão de 2026-11-14 (um só separador).
   Corre no próprio separador do SmiteBrain e navega dentro do site (cliques em links, sem recarregar a página).
   O SmiteBrain recarrega a página mais ou menos de hora a hora, o que mata o script: o progresso fica gravado a cada deus em
   localStorage["sb_parcial_<role>"], por isso basta verificar de vez em quando (window.__CADEIA.estado / .t) e, se o script
   desapareceu (window.__CADEIA indefinido), voltar a colá-lo: retoma onde ficou. Na volta, definir window.__ROLES com os roles em falta.
   "More Builds" é clicado no máximo 150 vezes por página (ou até passar 2 semanas).
   Formato gravado em localStorage["sb_raw_<role>"]:
     #ROLE <role> corte <AAAA-MM-DD> / #LISTA (lista gods Master+, Split by Aspect, Past 2 weeks) / #ITENS nomes "|" / #DEUSES_N nomes "|"
     #BUILDS — "## <slug> <role> <aspeto>" e depois uma linha por build: V|i1,i2,…,i6|starter|relíquia|e1,…,e5|dd/mm  (índices)
     #ERROS … / #FIM <role>  */
(() => {
  const w = new Worker(URL.createObjectURL(new Blob(["onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)"], { type: "text/javascript" })));
  let id = 0; const pend = {}; w.onmessage = e => { pend[e.data](); delete pend[e.data]; };
  const espera = ms => new Promise(r => { id++; pend[id] = r; w.postMessage({ id, ms }); });
  const J = () => window; const doc = () => document;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const CORTE = new Date(hoje.getTime() - 14 * 86400000);
  const dataDe = c => { const m = c.innerText.match(/(\d{1,2})\/(\d{1,2}),?/); if (!m) return null;
    let d = new Date(hoje.getFullYear(), +m[2] - 1, +m[1]); if (d > hoje) d = new Date(hoje.getFullYear() - 1, +m[2] - 1, +m[1]); return d; };
  const cards = () => { const d = doc(); return d ? [...d.querySelectorAll("div.border-l-8")] : []; };
  const pronto = (url, sel) => { const d = doc(); try { return d && d.readyState === "complete" && J().location.pathname + J().location.search === url && d.querySelector(sel || "select"); } catch (e) { return false; } };
  const ir = async (url, sel) => {
    for (let tent = 0; tent < 3; tent++) {
      try { const d = doc(); if (d && d.body && tent === 0) { const a = d.createElement("a"); a.href = url; d.body.appendChild(a); a.click(); a.remove(); } else J().location.href = url; } catch (e) { try { J().location.href = url; } catch (e2) {} }
      const t0 = Date.now(); while (Date.now() - t0 < 25000) { await espera(300); if (pronto(url, sel)) { await espera(1500); if (pronto(url, sel)) return true; } }
    }
    return false; };
  const carregar = async () => {
    for (let i = 0; i < 150; i++) { const cs = cards(); if (!cs.length) return "vazio";
      const d = dataDe(cs[cs.length - 1]); if (d && d < CORTE) return "2 semanas";
      const b = [...doc().querySelectorAll("button")].find(x => /More Builds/i.test(x.innerText)); if (!b) return "fim";
      const n = cs.length; b.click(); const t = Date.now(); while (cards().length === n && Date.now() - t < 10000) await espera(200);
      if (cards().length === n) return "parou"; }
    return "limite"; };
  const ler = async ROLE => {
    if (!await ir("/gods?division=master&splitByAspect=true&time=2w&role=" + ROLE, "tr a[href^='/gods/']")) throw new Error("lista não abriu");
    const LISTA = [...doc().querySelectorAll("tr")].map(tr => { const a = tr.querySelector('a[href^="/gods/"]'); if (!a) return null;
      const td = [...tr.querySelectorAll("td")].map(x => x.innerText.trim()).filter(Boolean); return a.getAttribute("href").split("?")[0].split("/")[2] + " | " + td.join(" | "); }).filter(Boolean);
    const deuses = [...new Set(LISTA.map(r => r.split(" | ")[0]))];
    const KP = "sb_parcial_" + ROLE, P = JSON.parse(localStorage.getItem(KP) || '{"feitos":[],"blocos":[],"erros":[],"I":[],"G":[]}');
    const idx = (arr, n) => { let k = arr.indexOf(n); if (k < 0) { arr.push(n); k = arr.length - 1; } return k; };
    for (const slug of deuses) { if (P.feitos.includes(slug)) continue;
      window.__CADEIA.estado = ROLE + " " + P.feitos.length + "/" + deuses.length + " a ler " + slug; window.__CADEIA.t = Date.now();
      const bl = [];
      try {
        if (!await ir("/gods/" + slug + "/builds/" + ROLE)) throw new Error("página não abriu");
        const sels = [...doc().querySelectorAll("select")];
        const sel = sels.find(s => [...s.options].some(o => o.value === "none"));
        const rank = sels.find(s => [...s.options].some(o => o.value === "master"));
        if (rank && rank.value !== "master") P.erros.push(slug + ":rank=" + rank.value);
        const asp = sel ? [...sel.options].filter(o => o.value !== "any").map(o => o.value) : ["none"];
        for (const v of asp) {
          if (!await ir("/gods/" + slug + "/builds/" + ROLE + "?aspect=" + v)) throw new Error("aspeto " + v + " não abriu");
          await carregar();
          const linhas = [];
          for (const c of cards()) { const d = dataDe(c); if (d && d < CORTE) continue;
            const its = [...c.querySelectorAll('a[href^="/items/"]')].map(a => { const i = a.querySelector("img"); return i ? i.alt.trim() : ""; });
            if (its.length < 3) continue;
            const imgs = [...c.querySelectorAll("img")]; const vs = [...c.querySelectorAll("*")].find(e => e.children.length === 0 && e.textContent.trim() === "vs");
            const inim = vs ? imgs.filter(i => vs.compareDocumentPosition(i) & 4).map(i => i.alt.trim()).filter(Boolean) : [];
            const core = its.slice(0, its.length - 2).slice(0, 6);
            linhas.push([/border-l-success/.test(c.className) ? 1 : 0, core.map(n => idx(P.I, n)).join(","), idx(P.I, its[its.length - 2]), idx(P.I, its[its.length - 1]),
              inim.map(n => idx(P.G, n)).join(","), d ? (d.getDate() + "/" + (d.getMonth() + 1)) : ""].join("|")); }
          if (linhas.length) bl.push("## " + slug + " " + ROLE + " " + v + "\n" + linhas.join("\n"));
        }
        P.blocos.push(...bl); P.feitos.push(slug);
      } catch (e) { P.tent = P.tent || {}; P.tent[slug] = (P.tent[slug] || 0) + 1; if (P.tent[slug] >= 3) { P.erros.push(slug + ":" + e.message); P.feitos.push(slug); } }
      localStorage.setItem(KP, JSON.stringify(P));
      window.__CADEIA.estado = ROLE + " " + P.feitos.length + "/" + deuses.length;
    }
    if (deuses.some(s => !P.feitos.includes(s))) return ler(ROLE); // deuses a repetir (a página falhou)
    localStorage.setItem("sb_raw_" + ROLE, "#ROLE " + ROLE + " corte " + CORTE.toISOString().slice(0, 10) + "\n#LISTA\n" + LISTA.join("\n") +
      "\n#ITENS\n" + P.I.join("|") + "\n#DEUSES_N\n" + P.G.join("|") + "\n#BUILDS\n" + P.blocos.join("\n") + "\n#ERROS " + P.erros.join(", ") + "\n#FIM " + ROLE + "\n");
    localStorage.removeItem(KP); return P.blocos.length + " blocos, erros: " + P.erros.length;
  };
  const roles = window.__ROLES || ["solo", "jungle", "mid", "support", "carry"];
  window.__CADEIA = { estado: "a começar", feitos: [], feito: false, t0: Date.now(), t: Date.now() };
  (async () => { for (const r of roles) { try { __CADEIA.feitos.push(r + ": " + await ler(r)); } catch (e) { __CADEIA.feitos.push(r + ": ERRO " + e.message); } }
    __CADEIA.feito = true; __CADEIA.estado = "feito"; })();
  return "a ler: " + roles.join(", ");
})();
