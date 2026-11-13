/* Leitor do SmiteBrain (corre na página https://smitebrain.com/gods?division=master&splitByAspect=true&time=2w&role=<role>).
   1) lê a lista do role (Master+, Split by Aspect, Past 2 weeks): deus, aspeto, tier, win, pick, jogos;
   2) abre cada deus nesse role com "Past 2 weeks" (navegação dentro do site) e lê a página toda:
      cabeçalho (jogos, win, pick), Aspects, Relics, Starters e as 6 ranhuras do Core, com pick% e win% de cada item.
   Corre em segundo plano; window.__SB.estado diz o progresso; window.__SB.texto() devolve tudo em texto. */
(() => {
  const ROLE = new URLSearchParams(location.search).get("role");
  const pw = t => { const m = t.match(/([\d.]+)%\s*pick\s*([\d.]+)%\s*win/); return m ? [+m[1], +m[2]] : null; };
  const lerDeus = () => {
    const sec = {}, body = document.body.innerText;
    const g = k => { const m = body.match(new RegExp("([\\d.,]+)%?\\s*\\n\\s*" + k)); return m ? m[1].replace(",", "") : null; };
    let s = null, slot = null; const W = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT); let n;
    while ((n = W.nextNode())) {
      if (n.children.length === 0) { const t = n.textContent.trim();
        if (/^(Aspects|Relics|Starters|Core)$/.test(t)) { s = t; slot = null; continue; }
        if (s === "Core" && /^[1-6]$/.test(t)) { slot = t; continue; } }
      if (n.tagName === "IMG" && n.alt && s) { let c = n, v = null;
        for (let k = 0; k < 5 && c && !v; k++) { c = c.parentElement; v = c && pw(c.innerText); }
        if (!v) continue; const key = s === "Core" ? "S" + (slot || "?") : s[0]; (sec[key] = sec[key] || []).push([n.alt.trim(), v[0], v[1]]); }
    }
    return { win: g("Win Rate"), pick: g("Pick Rate"), matches: g("Matches"), sec };
  };
  const irPara = async slug => {
    const a = document.createElement("a"); a.href = "/gods/" + slug + "?role=" + ROLE + "&time=2w"; document.body.appendChild(a); a.click(); a.remove();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) { await new Promise(r => setTimeout(r, 300));
      if (location.pathname === "/gods/" + slug && /\nCore\n/.test(document.body.innerText) && document.title.toLowerCase().includes(slug.split("-")[0].slice(0, 4))) break; }
    await new Promise(r => setTimeout(r, 800));
    return lerDeus();
  };
  const bloco = (slug, d) => { const f = (k, arr) => k + ": " + (arr || []).map(x => x[0] + " " + x[1] + " " + x[2]).join("; ");
    return ["## " + slug + " " + ROLE + " | " + d.matches + " | " + d.win + " | " + d.pick, f("A", d.sec.A), f("R", d.sec.R), f("ST", d.sec.S),
      ...[1, 2, 3, 4, 5, 6].map(i => f("S" + i, d.sec["S" + i]))].join("\n"); };
  const lista = [...document.querySelectorAll("tr")].map(tr => { const a = tr.querySelector('a[href^="/gods/"]'); if (!a) return null;
    const td = [...tr.querySelectorAll("td")].map(x => x.innerText.trim()).filter(Boolean);
    return { slug: a.getAttribute("href").split("?")[0].split("/")[2], linha: td.join(" | ") }; }).filter(Boolean);
  const slugs = [...new Set(lista.map(x => x.slug))];
  const SB = window.__SB = { role: ROLE, lista, slugs, blocos: [], erros: [], estado: "a começar", feito: false };
  SB.texto = () => "#LISTA " + ROLE + "\n" + lista.map(x => x.slug + " | " + x.linha).join("\n") + "\n#DEUSES " + ROLE + "\n" + SB.blocos.join("\n") + "\n#ERROS " + SB.erros.join(", ") + "\n#FIM " + ROLE + "\n";
  (async () => {
    for (let i = 0; i < slugs.length; i++) {
      try { const d = await irPara(slugs[i]); if (!d.sec.S1) SB.erros.push(slugs[i]); SB.blocos.push(bloco(slugs[i], d)); }
      catch (e) { SB.erros.push(slugs[i] + ":" + e.message); }
      SB.estado = (i + 1) + "/" + slugs.length;
    }
    SB.feito = true; SB.estado = "feito " + slugs.length;
  })();
  return "lista " + lista.length + " linhas, " + slugs.length + " deuses no role " + ROLE;
})();
