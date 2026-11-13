/* Leitor do SmiteBrain por aspeto (separador Builds, Rank Master+, filtro de aspeto), versão final de 2026-11-13.
   Correr numa página de https://smitebrain.com (por exemplo /about), com javascript_tool. Lê os roles em cadeia,
   em segundo plano, e grava cada um em localStorage["sb_raw_<role>"] (texto com #ROLE, #LISTA, #DEUSES, #ERROS, #FIM).
   - Para cada role: lista gods (Master+, Split by Aspect, Past 2 weeks) → para cada deus e cada aspeto (None / Aspect of ...)
     abre /gods/<deus>/builds/<role>?aspect=<v>, carrega "More Builds" até 14 dias atrás e junta pick% e win% por ranhura,
     starter e relíquia (vitória = cartão com a classe border-l-success).
   - As esperas usam um Web Worker (o Chrome trava os temporizadores de separadores em segundo plano).
   - Grava o progresso a cada deus em localStorage["sb_parcial_<role>"]: se a página bloquear, voltar a correr retoma.
   Progresso: window.__CADEIA.estado; fim: window.__CADEIA.feito === true. Roles a ler: window.__ROLES (por omissão os 5). */
(() => {
  const w = new Worker(URL.createObjectURL(new Blob(["onmessage=e=>setTimeout(()=>postMessage(e.data.id),e.data.ms)"], { type: "text/javascript" })));
  let id = 0; const pend = {}; w.onmessage = e => { pend[e.data](); delete pend[e.data]; };
  const espera = ms => new Promise(r => { id++; pend[id] = r; w.postMessage({ id, ms }); });
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const CORTE = new Date(hoje.getTime() - 14 * 86400000);
  const dataDe = c => { const m = c.innerText.match(/(\d{1,2})\/(\d{1,2}),/); if (!m) return null;
    let d = new Date(hoje.getFullYear(), +m[2] - 1, +m[1]); if (d > hoje) d = new Date(hoje.getFullYear() - 1, +m[2] - 1, +m[1]); return d; };
  const cards = () => [...document.querySelectorAll("div.border-l-8")];
  const ir = async (url, sel) => { const a = document.createElement("a"); a.href = url; document.body.appendChild(a); a.click(); a.remove();
    const t0 = Date.now(); while (Date.now() - t0 < 20000) { await espera(300); if (location.pathname + location.search === url && document.querySelector(sel || "select")) break; }
    await espera(1500); };
  const carregar = async () => {
    for (let i = 0; i < 400; i++) { const cs = cards(); if (!cs.length) return "vazio";
      const d = dataDe(cs[cs.length - 1]); if (d && d < CORTE) return "2 semanas";
      const b = [...document.querySelectorAll("button")].find(x => /More Builds/i.test(x.innerText)); if (!b) return "fim";
      const n = cs.length; b.click(); const t = Date.now(); while (cards().length === n && Date.now() - t < 10000) await espera(200);
      if (cards().length === n) return "parou"; }
    return "limite"; };
  const juntar = () => { const S = { n: 0, w: 0, ST: {}, R: {}, sl: [{}, {}, {}, {}, {}, {}] };
    const add = (o, k, v) => { const x = o[k] = o[k] || [0, 0]; x[0]++; if (v) x[1]++; };
    for (const c of cards()) { const d = dataDe(c); if (d && d < CORTE) continue; const v = /border-l-success/.test(c.className);
      const its = [...c.querySelectorAll('a[href^="/items/"]')].map(a => { const i = a.querySelector("img"); return i ? i.alt.trim() : ""; });
      if (its.length < 3) continue; S.n++; if (v) S.w++; add(S.ST, its[its.length - 2], v); add(S.R, its[its.length - 1], v);
      its.slice(0, its.length - 2).slice(0, 6).forEach((it, k) => add(S.sl[k], it, v)); }
    const f = o => Object.entries(o).sort((a, b) => b[1][0] - a[1][0]).map(([k, [n, v]]) => k + " " + Math.round(n / S.n * 1000) / 10 + " " + Math.round(v / n * 100)).join("; ");
    return { S, f }; };
  const ler = async ROLE => {
    await ir("/gods?division=master&splitByAspect=true&time=2w&role=" + ROLE, "tr a[href^='/gods/']");
    const LISTA = [...document.querySelectorAll("tr")].map(tr => { const a = tr.querySelector('a[href^="/gods/"]'); if (!a) return null;
      const td = [...tr.querySelectorAll("td")].map(x => x.innerText.trim()).filter(Boolean); return a.getAttribute("href").split("?")[0].split("/")[2] + " | " + td.join(" | "); }).filter(Boolean);
    const deuses = [...new Set(LISTA.map(r => r.split(" | ")[0]))];
    const KP = "sb_parcial_" + ROLE, P = JSON.parse(localStorage.getItem(KP) || '{"feitos":[],"blocos":[],"erros":[]}');
    for (const slug of deuses) { if (P.feitos.includes(slug)) continue;
      try {
        await ir("/gods/" + slug + "/builds/" + ROLE);
        const sel = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "none"));
        const rank = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "master"));
        if (rank && rank.value !== "master") P.erros.push(slug + ":rank=" + rank.value);
        const asp = sel ? [...sel.options].filter(o => o.value !== "any").map(o => [o.value, o.text.trim()]) : [["none", "None"]];
        for (const [v, nome] of asp) {
          await ir("/gods/" + slug + "/builds/" + ROLE + "?aspect=" + v);
          const motivo = await carregar(); const { S, f } = juntar(); if (!S.n) continue;
          P.blocos.push(["## " + slug + " " + ROLE + " " + v + " | " + S.n + " | " + Math.round(S.w / S.n * 1000) / 10 + " | " + motivo, "A: " + nome,
            "R: " + f(S.R), "ST: " + f(S.ST), ...S.sl.map((o, k) => "S" + (k + 1) + ": " + f(o))].join("\n")); }
      } catch (e) { P.erros.push(slug + ":" + e.message); }
      P.feitos.push(slug); localStorage.setItem(KP, JSON.stringify(P));
      window.__CADEIA.estado = ROLE + " " + P.feitos.length + "/" + deuses.length;
    }
    localStorage.setItem("sb_raw_" + ROLE, "#ROLE " + ROLE + " corte " + CORTE.toISOString().slice(0, 10) + "\n#LISTA\n" + LISTA.join("\n") + "\n#DEUSES\n" +
      P.blocos.join("\n") + "\n#ERROS " + P.erros.join(", ") + "\n#FIM " + ROLE + "\n");
    localStorage.removeItem(KP); return P.blocos.length + " blocos, erros: " + P.erros.length;
  };
  const roles = window.__ROLES || ["solo", "jungle", "mid", "support", "carry"];
  window.__CADEIA = { estado: "a começar", feitos: [], feito: false, t0: Date.now() };
  (async () => { for (const r of roles) { try { __CADEIA.feitos.push(r + ": " + await ler(r)); } catch (e) { __CADEIA.feitos.push(r + ": ERRO " + e.message); } }
    __CADEIA.feito = true; __CADEIA.estado = "feito"; })();
  return "a ler " + roles.join(", ") + " desde " + CORTE.toISOString().slice(0, 10);
})();
