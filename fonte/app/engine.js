/* SMITE 2 Build Analyst — motor de recomendação v3.
   Sem etiquetas: cada build é avaliada por simulação contra os kits reais dos inimigos escolhidos
   (dano, tipo, ataques básicos, crítico, curas, escudos e CC lidos nas capturas) e contra todos os efeitos
   dos itens (stats, passivas, ativos, anti-heal, anti-escudo, tenacity, bloqueio de CC...).
   Valores do cliente; tempos ativos, taxas de acerto e os pacotes de itens dos inimigos são pressupostos marcados. */
(function (root) {
  "use strict";
  /* Idioma: globalThis.SMITE_LANG = "pt" | "en" (a página muda-o). L(pt, en) escolhe o texto; DS() é o separador decimal. */
  const L = (pt, en) => (globalThis.SMITE_LANG === "en" ? en : pt);
  const DS = () => (globalThis.SMITE_LANG === "en" ? "." : ",");

  const W = 20; // janela de luta (s)
  /* Pesos dano/sobrevivência e foco recebido por role. Calibrados (11/11/2026) contra os casos de teste do SmiteBrain
     (kb_src/casos_teste): quem joga Jungle/Mid/Carry escolhe lutas e recebe muito menos foco do que "3 inimigos em cima". */
  const ROLE_W = globalThis.__RW || { Solo: [0.7, 0.3], Jungle: [0.85, 0.15], Mid: [0.9, 0.1], Support: [0.25, 0.75], Carry: [0.9, 0.1] };
  const BA_UP = { Carry: 0.6, Jungle: 0.45, Solo: 0.45, Mid: 0.3, Support: 0.3 };
  /* objetivo Resistência = "contar que sou o alvo": o foco inimigo sobe, para a defesa passar a valer também nos roles de trás */
  /* Otimizado: o foco que se recebe sobe (ou desce) com o dano que a equipa adversária traz face ao típico */
  const OTIM_XP_POW = +(globalThis.__OP || 3);
  /* Dano: "não sou eu o alvo" — o foco recebido desce */
  const DANO_XP_K = +(globalThis.__DK || 0.5);
  const RES_XP_K = +(globalThis.__RK || 1.5), RES_XP_MIN = +(globalThis.__RM || 0.9);
  const EXPOSE = globalThis.__EX || { Solo: 1.5, Support: 1.1, Jungle: 0.2, Mid: 0.25, Carry: 0.2 }; // fração do foco inimigo (3 inimigos) que recai sobre o role — calibrado
  const LANE = { Solo: "solo", Mid: "mid", Jungle: "jungle", Carry: "duo", Support: "duo" };
  const AOE_EXTRA = 0.4; // pressuposto: uma habilidade de área atinge em média +0,4 alvos extra numa luta
  const HIT_AB = 0.7, HIT_CC = 0.5, ENGAGED = +(globalThis.__ENG || 3); // pressupostos: acerto das habilidades, do CC e nº de inimigos que lutam consigo
  const STARTERS = {
    Solo: ["warriors_axe", "deaths_toll", "bluestone_pendant", "leather_cowl", "vampiric_shroud"],
    Jungle: ["bumbas_golden_dagger", "bumbas_cudgel"],
    Mid: ["conduit_gem", "sands_of_time", "bluestone_pendant", "vampiric_shroud"],
    Support: ["selflessness", "war_flag"],
    Carry: ["gilded_arrow", "leather_cowl", "deaths_toll"]
  };
  const UPG = { warriors_axe: "sundering_axe", deaths_toll: "deaths_embrace", bluestone_pendant: "bluestone_brooch", leather_cowl: "hunters_cowl",
    vampiric_shroud: "blood_soaked_shroud", bumbas_golden_dagger: "bumbas_spear", bumbas_cudgel: "bumbas_hammer", conduit_gem: "archmages_gem",
    sands_of_time: "pendulum_of_the_ages", selflessness: "heroism", war_flag: "war_banner", gilded_arrow: "sharpshooters_arrow" };
  const RELICS = ["purification_beads", "aegis_of_acceleration", "phantom_shell", "sundering_arc", "agility_relic", "blink_rune"];
  /* Identidade do role: nº máximo de itens puramente defensivos. Solo = bruiser. */
  const MAX_PURE_DEF = { Solo: 2, Jungle: 1, Mid: 1, Carry: 1, Support: 6 };
  const ROLE_ID_PT = { Solo: "bruiser: dano e proteções", Jungle: "dano com alguma resistência", Mid: "dano", Carry: "dano", Support: "proteção e utilidade" };
  const ROLE_ID_EN = { Solo: "bruiser: damage and protections", Jungle: "damage with some durability", Mid: "damage", Carry: "damage", Support: "protection and utility" };
  const OFF_FX = ["hit", "hab", "ativo", "dps", "amp", "ba_amp", "anti_heal", "anti_escudo"];
  function isOff(it) { const s = it.stats; return !!(s.str || s.int || s.ad || s.as_pct || s.crit_pct || s.pen || s.pen_pct || s.adapt_str || s.adapt_int)
    || (it.efeitos || []).some(e => OFF_FX.includes(e.t) || (e.t === "stats" && e.s && (e.s.str || e.s.int || e.s.as_pct || e.s.ad || e.s.pen_pct))); }
  function isDef(it) { const s = it.stats; return !!(s.pp || s.mp || (s.hp || 0) >= 150 || s.plating || s.dampening); }
  function pureDef(it) { return isDef(it) && !isOff(it); }
  const PATH_LABEL_PT = { forca: "Força", inteligencia: "Inteligência", ataque: "Ataque (AD / attack speed / crítico)", hibrido: "Híbrido" };
  const PATH_LABEL_EN = { forca: "Strength", inteligencia: "Intelligence", ataque: "Attack (AD / attack speed / crit)", hibrido: "Hybrid" };
  const PL = p => L(PATH_LABEL_PT, PATH_LABEL_EN)[p];
  const EST_LABEL_PT = { crit: "crítico", ataque: "ataque", hab: "habilidades", bruiser: "bruiser", tank: "tanque" };
  const EST_LABEL_EN = { crit: "crit", ataque: "attack", hab: "abilities", bruiser: "bruiser", tank: "tank" };
  /* Pacote de itens assumido para cada inimigo (6 itens ao nível 20). PRESSUPOSTO: serve só para dar ordem de grandeza
     ao dano, vida e proteções do kit inimigo; o estilo pode ser indicado na página. */
  const PKG = {
    crit: { pwr: 40, ad: 80, as_pct: 90, crit_pct: 70, pen: 0, pen_pct: 10, hp: 300, pp: 20, mp: 20, ls_pct: 8, cdr: 0, forca: true },
    ataque: { pwr: 80, ad: 60, as_pct: 110, crit_pct: 0, pen: 10, pen_pct: 10, hp: 400, pp: 30, mp: 30, ls_pct: 10, cdr: 0, forca: true },
    hab: { pwr: 320, ad: 0, as_pct: 0, crit_pct: 0, pen: 15, pen_pct: 10, hp: 400, pp: 20, mp: 30, ls_pct: 0, cdr: 20 },
    bruiser: { pwr: 170, ad: 0, as_pct: 30, crit_pct: 0, pen: 10, pen_pct: 0, hp: 1300, pp: 90, mp: 80, ls_pct: 4, cdr: 20 },
    tank: { pwr: 60, ad: 0, as_pct: 0, crit_pct: 0, pen: 0, pen_pct: 0, hp: 1900, pp: 150, mp: 140, ls_pct: 0, cdr: 20 }
  };
  const EST_ROLE = { Carry: ["crit", "ataque", "hab"], Mid: ["hab", "ataque"], Jungle: ["hab", "ataque"], Solo: ["bruiser"], Support: ["tank"] };
  const NOTE_EN = {"próximo ataque após habilidade": "next attack after an ability", "-0.66s por ataque reforçado": "-0.66s per empowered attack", "-0.33s nos cooldowns por ataque": "-0.33s on cooldowns per attack", "imune a CC 2s": "CC immune 2s", "iniciação: valor de posicionamento não entra nas contas": "initiation: positioning value is not counted", "20%-40% menos dano de ataque durante 3s (por confirmar)": "20%-40% less attack damage for 3s (to be confirmed)", "evoluído: 3% da mana de itens, com +500 de Mana Infusion e +100 da evolução": "evolved: 3% of item mana, with +500 from Mana Infusion and +100 from the evolution", "no ataque básico a seguir a uma habilidade (cooldown interno 2s)": "on the basic attack after an ability (2s internal cooldown)", "ativo: 6 ataques a cada 15s": "active: 6 attacks every 15s", "4 stacks de -7%": "4 stacks of -7%", "140 a cada 3 habilidades": "140 every 3 abilities", "kill -3s/-10s, assist -1,5s/-5s; assume 0,5 kills e 1 assist por luta": "kill -3s/-10s, assist -1.5s/-5s; assumes 0.5 kills and 1 assist per fight", "4 ticks de 1.2% + 3%": "4 ticks of 1.2% + 3%", "2% da Força em % da vida máxima": "2% of Strength as % max health", "2 projéteis de 10 + 30% AD; ligado metade do tempo por gastar 5% da mana máxima por segundo": "2 projectiles of 10 + 30% AD; on half the time because it costs 5% max mana per second", "dano do monstro invocado não modelado": "summoned monster damage not modelled", "conversão de lifesteal em dano não modelada": "lifesteal-to-damage conversion not modelled", "evoluído": "evolved", "-1s por cada ~1000 de vida perdida ao nível 20; assume 2 por luta": "-1s per ~1000 health lost at level 20; assumes 2 per fight", "só mágica; aura": "magical only; aura", "-3s quando sofre dano mágico de habilidade (cooldown 20s)": "-3s when taking magical ability damage (20s cooldown)", "PRESSUPOSTO: consome ~15 stacks por luta (1 por dano recebido); 1% da vida máxima por stack, área de 4m": "ASSUMPTION: consumes ~15 stacks per fight (1 per damage taken); 1% max health per stack, 4m area", "6 stacks de +6.5% AS, metade do tempo": "6 stacks of +6.5% AS, half the time", "bónus de 25% só atinge inimigos à volta do alvo (OB34): ignorado em 1x1": "25% bonus only hits enemies around the target (OB34): ignored in 1v1", "com ~50% da mana disponível": "with ~50% of mana available", "perto de um deus": "near a god", "cada habilidade que acerta num deus; +50% nos hits seguintes no mesmo alvo durante 3s (confirmado pelo Micael). Sem cooldown: o bónus dos hits seguintes em 3s só faz sentido se pode voltar a ativar dentro desse tempo (inferência; o antigo pressuposto de 10s foi retirado)": "each ability that hits a god; +50% on the following hits on the same target for 3s (confirmed by Micael). No cooldown: the follow-up bonus within 3s only makes sense if it can trigger again in that time (inference; the old 10s assumption was removed)", "menos penalização ao atacar / projéteis mais rápidos": "less penalty when attacking / faster projectiles", "-1s a cada 10s": "-1s every 10s", "evoluído: 7% da mana de itens, com +500 de Mana Infusion e +100 da evolução": "evolved: 7% of item mana, with +500 from Mana Infusion and +100 from the evolution", "no ataque básico a seguir a uma habilidade": "on the basic attack after an ability", "75 stacks completos": "75 full stacks", "8 stacks": "8 stacks", "-1s/-5s por kill ou assist (cliente); assume 1,5 por luta": "-1s/-5s per kill or assist (client); assumes 1.5 per fight", "Shattering na 1ª habilidade a cada 10s": "Shattering on the 1st ability every 10s", "ativo de 10s a cada 120s: metade das lutas": "10s active every 120s: half the fights", "-5, até -20 com kills": "-5, up to -20 with kills", "após crítico, 3s": "after a crit, 3s", "6 stacks de +30": "6 stacks of +30", "2 stacks médios de Jagged Wounds": "2 average stacks of Jagged Wounds", "ativo 6s a cada 45s": "6s active every 45s", "ativo -4s a cada 40s": "active -4s every 40s", "3 stacks de -3.5%": "3 stacks of -3.5%", "metade do máximo, vida baixa": "half of max, low health", "15 + stacks médios": "15 + average stacks", "cliente: +15 vida por stack (máx 40 = 600) +100 e +10/+10 ao evoluir; stacks: +1 por minion com assistência, +5 por abate/assistência a deus. PRESSUPOSTO: em média 55% do valor ao longo da partida (85% no Support, que ganha assistências de minions na lane do Carry)": "client: +15 health per stack (max 40 = 600) +100 and +10/+10 when evolved; stacks: +1 per minion assist, +5 per god kill/assist. ASSUMPTION: on average 55% of the value over the game (85% for Support, which gets minion assists in the Carry lane)", "2 deuses perto": "2 gods nearby", "só física; aura": "physical only; aura", "reflete 40% dos ataques e 20% das habilidades recebidos (antes de mitigação) durante 4s": "reflects 40% of basic attacks and 20% of abilities taken (before mitigation) for 4s", "abaixo de 60%": "below 60%", "só abaixo de 40% de vida": "only below 40% health", "bloqueia 1 hard CC a cada 90s": "blocks 1 hard CC every 90s", "12 ticks extra em 4s": "12 extra ticks over 4s", "vida roubada acumulada": "accumulated stolen health", "Flurry dá attack speed por deus atingido (valor sem número)": "Flurry gives attack speed per god hit (value not numbered)", "proteções por deus atingido (OB36, 10 no rank 5)": "protections per god hit (OB36, 10 at rank 5)", "1.5% da vida máxima x4 por disparo do Flurry (OB36)": "1.5% max health x4 per Flurry shot (OB36)", "Dart pode reiniciar até 2x": "Dart can reset up to 2x", "Dart empurra e explode depois (dano sem número)": "Dart pushes and explodes later (damage not numbered)", "Acorn Blast cola e explode (dano no kit)": "Acorn Blast sticks and explodes (damage in the kit)", "+7% de dano recebido por stack, até 21% (OB36)": "+7% damage taken per stack, up to 21% (OB36)"};
  const PRESSUPOSTOS = [
    "Luta de 20s ao nível 20, habilidades no nível 5; ultimate usada uma vez.",
    "Cada inimigo é simulado a partir do próprio kit (dano, escalas, cooldowns, ataque básico, curas, escudos e CC lidos nas capturas) com um pacote de 6 itens assumido pelo estilo: crítico, ataque, habilidades, bruiser (Solo) ou tanque (Support). Sem estilo indicado, escolhe-se o que mais dano dá ao kit dentro do role.",
    "Acerto: 70% das habilidades e 50% do CC; numa luta enfrenta em média 3 inimigos, o adversário da sua lane pesa 1,5×. O foco que recebe depende do role (Solo 150%, Support 110%, Mid 25%, Jungle e Carry 20% de 3 inimigos) e os pesos dano/sobrevivência também (Solo 70/30, Jungle 85/15, Mid e Carry 90/10, Support 25/75): valores calibrados contra builds reais de jogadores Master+ (SmiteBrain, OB47), usadas só como casos de teste.",
    "Tempo a dar ataques básicos: Carry 60%, Solo/Jungle 45%, Mid/Support 30%; slows recebidos cortam-no (mais em corpo a corpo).",
    "Só causa dano enquanto está vivo: conta o dano feito até morrer (vida e escudos contra o dano recebido menos a cura), no máximo 20s. As habilidades abrem a luta todas prontas, por isso o burst conta mesmo numa vida curta; o dano de ataques básicos é contínuo e perde-se se morrer cedo.",
    "Attack speed base 1,0 com +28% por nível; crítico a 175% de dano; cooldown rate limitado a 40%.",
    "O CC duro que sofre tira tempo de dano; tenacity encurta-o e Magi's Cloak, Purification Beads e semelhantes bloqueiam instâncias.",
    "Anti-heal e anti-escudo não acumulam: conta o mais forte, pelo tempo ativo.",
    "Passivas condicionais e stacks dos itens entram com um tempo ativo médio (indicado em cada item).",
    "Habilidades começam a luta prontas (0,5 + 20s/cooldown lançamentos); a ultimate está disponível em min(1, 60s/cooldown) das lutas, por isso o cooldown da ultimate e os reembolsos por kill/assist contam.",
    "Dano por tick multiplicado pelo nº de ticks lido na descrição (\"N times\", \"every Xs for Ys\"); habilidades de área atingem em média +0,4 alvos extra. O dano de invocações não é contado.",
    "Efeitos no ataque a seguir a uma habilidade (Polynomicon, Hydra's Lament) só disparam se houver ataques básicos para isso.",
    "Sobreviver conta até 30s; a build final é melhorada trocando item a item até nenhuma troca ajudar, e a ordem de compra é a ordem em que cada item mais rende.",
    "Build: a mais usada pelos jogadores Master+ deste deus neste role, com ou sem aspeto conforme a escolha, nas últimas 2 semanas (SmiteBrain, separador Builds, build a build). Cada build lida tem os itens por ordem de compra, o starter, a relíquia, o resultado e os 5 inimigos. As builds contra equipas parecidas com a escolhida contam mais: peso = (1 + inimigos iguais)^1,5 × semelhança da composição² (tipo de dano e role principal de cada inimigo). A build é montada ranhura a ranhura: em cada ranhura, o item mais comprado nessa posição pelas builds que começaram da mesma forma (se houver pelo menos 15); senão pelas que têm os mesmos itens; senão por todas. Com menos de 25 builds na versão escolhida, juntam-se as da outra versão com 40% do peso. Sem builds suficientes, volta ao método anterior (3 itens core dos dados + 3 situacionais da simulação).",

    "Objetivo: Otimizado ajusta o foco que recebe ao dano que a equipa adversária traz e o peso dano/sobrevivência ao que falta à sua equipa e ao que a adversária ameaça. Dano assume que não é o alvo principal (metade do foco) e passa 60% do peso da sobrevivência para o dano. Resistência assume que é o alvo (foco 1,5×, no mínimo 90% de 3 inimigos) e passa metade do peso do dano para a sobrevivência.",
    "Identidade do role: Solo é bruiser (no máximo 2 itens só defensivos), Jungle/Mid/Carry no máximo 1, Support sem limite."
  ];
  const PRESSUPOSTOS_EN = [
      "20s fight at level 20, abilities at rank 5; ultimate used once.",
      "Each enemy is simulated from its own kit (damage, scalings, cooldowns, basic attack, heals, shields and CC read from the game client) with a 6-item package assumed from its style: crit, attack, abilities, bruiser (Solo) or tank (Support). With no style set, the one that gives the kit the most damage within its role is used.",
      "Hit rate: 70% of abilities and 50% of CC; a fight is on average against 3 enemies, and your lane opponent weighs 1.5×. The focus you take depends on the role (Solo 150%, Support 110%, Mid 25%, Jungle and Carry 20% of 3 enemies) and so do the damage/survival weights (Solo 70/30, Jungle 85/15, Mid and Carry 90/10, Support 25/75): values calibrated against real Master+ player builds (SmiteBrain, OB47), used only as test cases.",
      "Time spent basic attacking: Carry 60%, Solo/Jungle 45%, Mid/Support 30%; slows taken cut it (more for melee).",
      "You only deal damage while alive: damage counts until you die (health and shields against damage taken minus healing), up to 20s. Abilities open the fight all ready, so burst counts even with a short life; basic attack damage is continuous and is lost if you die early.",
      "Base attack speed 1.0 with +28% per level; crits deal 175% damage; cooldown rate capped at 40%.",
      "Hard CC taken removes damage time; tenacity shortens it, and Magi's Cloak, Purification Beads and the like block instances.",
      "Anti-heal and anti-shield do not stack: the strongest counts, for its active time.",
      "Conditional passives and item stacks count with an average active time (shown on each item).",
      "Abilities start the fight ready (0.5 + 20s/cooldown casts); the ultimate is available in min(1, 60s/cooldown) of fights, so ultimate cooldown and kill/assist refunds count.",
      "Damage per tick multiplied by the number of ticks read from the description (\"N times\", \"every Xs for Ys\"); area abilities hit +0.4 extra targets on average. Summon damage is not counted.",
      "On-hit effects after an ability (Polynomicon, Hydra's Lament) only trigger if there are basic attacks to use them.",
      "Survival counts up to 30s; the final build is improved by swapping item by item until no swap helps, and the buy order is the order in which each item adds the most.",
      "Build: the most played by Master+ players of this god in this role, with or without the aspect as chosen, over the last 2 weeks (SmiteBrain, Builds tab, build by build). Each build read has the items in purchase order, the starter, the relic, the result and the 5 enemies. Builds against teams similar to the chosen one count more: weight = (1 + same enemies)^1.5 × composition similarity² (damage type and main role of each enemy). The build is assembled slot by slot: in each slot, the item bought most in that position by builds that started the same way (if there are at least 15); otherwise by those with the same items; otherwise by all. With fewer than 25 builds in the chosen version, those of the other version are added at 40% weight. Without enough builds, it falls back to the previous method (3 core items from data + 3 situational from the simulation).",

      "Objective: Optimised scales the focus you take with the enemy team's damage, and the damage/survival weight with what your team lacks and what the enemy threatens. Damage assumes you are not the main target (half the focus) and moves 60% of the survival weight to damage. Durability assumes you are the target (1.5× focus, at least 90% of 3 enemies) and moves half of the damage weight to survival.",
      "Role identity: Solo is a bruiser (at most 2 purely defensive items), Jungle/Mid/Carry at most 1, Support no limit."
  ];
  const PRIOR_ROLE = +(globalThis.__PR ?? 1); // fração do sinal quando vem da média do role (deus sem dados próprios)
  const DUEL_W = globalThis.__DW || {}; // desligado: não melhorou os casos de teste // peso do duelo de lane 1v1 (fase de lane do Solo)
  const LAMBDA_DADOS = +(globalThis.__L1 ?? 0.01), USO_DADOS = +(globalThis.__U ?? 6); // peso do sinal de dados de jogo: +0,03 na nota por ponto de win rate acima do esperado (já corrigido e encolhido)
  const STAT_KEYS = ["str", "int", "ad", "as_pct", "crit_pct", "crit_dmg", "pen", "pen_pct", "cdr", "hp", "pp", "mp", "ls_pct", "mana", "mp5", "hp5", "mitig_pct",
    "str_pct", "int_pct", "prot_pct", "int_itens_pct", "tenacity"];

  function Engine(data) {
    this.data = data;
    this.items = Object.fromEntries(data.itens.map(i => [i.id, i]));
    this.gods = Object.fromEntries(data.deuses.map(g => [g.id, g]));
    const ads = data.deuses.map(g => g.ad20).filter(Boolean).sort((a, b) => a - b);
    this.adMed = ads[Math.floor(ads.length / 2)] || 90;
    this._cacheEn = {};
    // adversário de lane genérico do Solo: média de bruisers típicos simulados a partir dos próprios kits
    const typ = ["bellona", "osiris", "achilles", "guan_yu", "hercules", "amaterasu"].filter(x => this.gods[x]).map(x => this.enemySim(this.gods[x], false, "Solo", "bruiser"));
    const avg = k => typ.reduce((a, e) => a + e[k], 0) / (typ.length || 1);
    this.genericLane = { nome: "bruiser típico", tipo: "fisico", hp: avg("hp"), hpBase: avg("hpBase"), hpItem: avg("hpItem"), pp: avg("pp"), mp: avg("mp"), heal: avg("heal"), shield: avg("shield"),
      abil: avg("abil"), ba: avg("ba"), critPart: 0, pen: 10, pen_pct: 0, wOff: 1 };
  }

  /* ---------- kit do deus ---------- */
  Engine.prototype.godKit = function (g, aspect) {
    let ab = g.habilidades.slice();
    if (aspect && g.habilidades_aspeto.length) {
      const names = new Set(g.habilidades_aspeto.map(a => a.nome));
      ab = ab.filter(a => !names.has(a.nome)).concat(g.habilidades_aspeto);
    }
    const ba = (aspect && g.ba_aspeto) || g.ba || { str: 100, int: 20, ad: 100 };
    let s = 0, i = 0, cc = 0;
    ab.forEach(a => { s += a.str; i += a.int; if (a.cc) cc += a.cc.duro + 0.5 * a.cc.deslocamento; });
    const ranged = g.alcance === "ranged" || (ba.alcance_m && ba.alcance_m > 6);
    return { ab, ba, str: s, int: i, cc, ranged, selfHeal: ab.some(a => a.cura), passiva: g.passiva_buff || null, baDefault: !g.ba, tipo: g.tipo_dano || "fisico" };
  };
  const FIGHT_EVERY = 60, REF = { hab: 0, ult: 0 }; // pressuposto: uma luta a cada ~60s
  /* Habilidades começam a luta prontas: em média 0,5 + janela/cooldown lançamentos. A ultimate está disponível em
     min(1, 60s / cooldown) das lutas. Reembolsos por kill/assist encurtam os cooldowns. */
  const casts = (a, cdr, ref, ultCdr, tau) => {
    ref = ref || REF; tau = tau ?? W; const cd = (a.cd || 12) * (1 - cdr);
    if (a.ult) return Math.min(1, FIGHT_EVERY / Math.max(10, cd * (1 - (ultCdr || 0) / 100) - ref.ult));
    return 1 + Math.max(0, tau - 1.5) / cd + ref.hab / cd * tau / W;
  };
  function kitBuffs(kit, t) {
    kit.ab.forEach(a => {
      if (!a.buff) return;
      const up = a.ult ? Math.min(1, (a.dur || 5) / W) : Math.min(1, (a.dur || 4) / Math.max(4, (a.cd || 12)));
      const b = a.buff;
      t.str += (b.str || 0) * up; t.int += (b.int || 0) * up; t.as_pct += (b.as_pct || 0) * up; t.ad += (b.ad || 0) * up;
      t.pp += ((b.pp || 0) + (b.prot || 0)) * up; t.mp += ((b.mp || 0) + (b.prot || 0)) * up; t.ls_pct += (b.ls_pct || 0) * up; t.mitig_pct += (b.mitig_pct || 0) * up;
    });
    const pb = kit.passiva;
    if (pb) { t.str += (pb.str || 0) * 0.5; t.int += (pb.int || 0) * 0.5; t.as_pct += (pb.as_pct || 0) * 0.5; t.ad += (pb.ad || 0) * 0.5;
      t.pp += (pb.pp || 0) * 0.5 + (pb.prot || 0) * 0.5; t.mp += (pb.mp || 0) * 0.5 + (pb.prot || 0) * 0.5; t.prot_pct += ((pb.pp_pct || 0) + (pb.mp_pct || 0) + (pb.prot_pct || 0)) / 2 * 0.5; }
  }
  function kitDebuffUp(a) { return Math.min(1, (a.debuff_dur || 3) / Math.max(4, a.cd || 12)); }

  /* ---------- inimigos: simulação a partir do kit ---------- */
  Engine.prototype.enemySim = function (g, aspect, role, est) {
    const kit = this.godKit(g, aspect), P = PKG[est];
    const t = { str: 0, int: 0, ad: P.ad, as_pct: P.as_pct, pp: P.pp, mp: P.mp, ls_pct: P.ls_pct, mitig_pct: 0, prot_pct: 0 };
    const toStr = P.forca || kit.str >= kit.int;
    if (toStr) t.str += P.pwr; else t.int += P.pwr;
    if (role === "Jungle" && est !== "tank") { t.str *= 0.85; t.int *= 0.85; t.pp += 40; t.mp += 40; }
    kitBuffs(kit, t);
    const cdr = P.cdr / 100;
    let abil = 0, heal = 0, shield = 0, cc = 0, root = 0, slow = 0, desl = 0, antiHeal = 0, ccInst = 0, ccN = 0;
    kit.ab.forEach(a => {
      const n = casts(a, cdr);
      abil += n * HIT_AB * ((a.dano || 0) + (a.str || 0) / 100 * t.str + (a.int || 0) / 100 * t.int);
      if (a.cura) heal += n * (a.cura.base + (a.cura.str || 0) / 100 * t.str + (a.cura.int || 0) / 100 * t.int);
      if (a.escudo) shield += (a.ult ? 1 : Math.min(n, 2)) * (a.escudo.base + (a.escudo.str || 0) / 100 * t.str + (a.escudo.int || 0) / 100 * t.int);
      if (a.cc) { const d = a.cc.duro + 0.5 * a.cc.deslocamento; cc += n * HIT_CC * d; desl += n * HIT_CC * 0.5 * a.cc.deslocamento;
        if (d) { ccInst += d; ccN++; } root += n * HIT_CC * a.cc.root; slow += n * HIT_CC * (a.cc.slow_dur || 0) * (a.cc.slow_pct || 0) / 100; }
      if (a.debuff && a.debuff.anti_heal_pct) antiHeal = Math.max(antiHeal, a.debuff.anti_heal_pct * kitDebuffUp(a));
    });
    const AS = Math.min(2.5, 1.0 * (1 + (28 + t.as_pct) / 100));
    const up = (BA_UP[role] || 0.4) * (est === "hab" ? 0.8 : est === "tank" ? 0.6 : 1);
    const ba = kit.ba, adTot = (g.ad20 || this.adMed) + t.ad;
    const perHit = adTot * (ba.ad ?? 100) / 100 + t.str * (ba.str ?? 100) / 100 + t.int * (ba.int ?? 20) / 100;
    const crit = Math.min(P.crit_pct, 100) / 100, critMul = 1 + crit * 0.75;
    const baDmg = AS * W * up * perHit * critMul;
    heal += (t.ls_pct / 100) * (abil + baDmg) * 0.6;
    const hpItem = P.hp + (role === "Jungle" && est !== "tank" ? 300 : 0), hp = (g.hp20 || 2300) + hpItem;
    return {
      kit, est, tipo: kit.tipo, abil, ba: baDmg, critPart: baDmg * (1 - 1 / critMul), total: abil + baDmg,
      pen: P.pen, pen_pct: P.pen_pct, hp, hpBase: g.hp20 || 2300, hpItem,
      pp: ((g.pp20 || 60) + t.pp) * (1 + t.prot_pct / 100), mp: ((g.mp20 || 50) + t.mp) * (1 + t.prot_pct / 100),
      heal, shield, cc, root, slow, desl, antiHeal, ccMed: ccN ? ccInst / ccN : 1, mitig: t.mitig_pct
    };
  };
  /* role principal de um deus (dados de jogo): para Joust/Duel, onde não há roles fixos */
  Engine.prototype.mainRole = function (id) { const c = this.data.comunidade && this.data.comunidade.deuses[id]; return (c && c.role) || "Mid"; };
  /* tamanho das equipas por modo */
  const TEAM_N = { Joust: 3, Duel: 1 };
  Engine.prototype.enemies = function (list, myRole) {
    const out = (list || []).map(x => typeof x === "string" ? { id: x } : x).filter(x => this.gods[x.id]).map(x => {
      const g = this.gods[x.id], role = x.role || this.mainRole(x.id);
      const key = [x.id, !!x.aspeto, role, x.estilo || ""].join("|");
      let sim = this._cacheEn[key], auto = !x.estilo;
      if (!sim) {
        if (x.estilo) sim = this.enemySim(g, x.aspeto, role, x.estilo);
        else (this.estStyle(x.id, role) || EST_ROLE[role] || ["hab", "ataque"]).forEach(es => { const s = this.enemySim(g, x.aspeto, role, es); if (!sim || s.total > sim.total) sim = s; });
        this._cacheEn[key] = sim;
      }
      const lane = x.lane !== undefined ? !!x.lane : !!(x.role && myRole && LANE[x.role] === LANE[myRole]);
      return Object.assign({ id: x.id, nome: g.nome + (x.aspeto ? L(" (aspeto)", " (aspect)") : ""), role, auto, lane, wOff: lane ? 1.5 : 1, wIn: lane ? 1.5 : 1 }, sim);
    });
    const sIn = out.reduce((a, e) => a + e.wIn, 0) || 1, f = Math.min(out.length, ENGAGED) / sIn;
    out.forEach(e => e.fIn = e.wIn * f);
    return out;
  };
  /* Perfil numérico da equipa inimiga, para mostrar na página */
  Engine.prototype.profile = function (en) {
    if (!en.length) return null;
    let fis = 0, mag = 0, ba = 0, crit = 0, heal = 0, shield = 0, cc = 0, slow = 0;
    en.forEach(e => { const d = e.total * e.fIn; if (e.tipo === "magico") mag += d; else fis += d; ba += e.ba * e.fIn; crit += e.critPart * e.fIn;
      heal += e.heal; shield += e.shield; cc += e.cc * e.fIn; slow += e.slow * e.fIn; });
    const tot = fis + mag || 1;
    return { inimigos: en.map(e => ({ nome: e.nome, role: e.role, estilo: L(EST_LABEL_PT, EST_LABEL_EN)[e.est], auto: e.auto, tipo: e.tipo, dano: e.total, ba: e.ba / (e.total || 1), crit: e.critPart / (e.total || 1),
      cura: e.heal, escudo: e.shield, cc: e.cc, hp: e.hp, lane: e.lane })),
      fis: fis / tot, ba: ba / tot, crit: crit / tot, cura: heal, escudo: shield, cc, slow, recebido: tot };
  };

  /* ---------- stats + efeitos ---------- */
  function condOk(e, ctx) {
    if (!e.cond) return true;
    if (e.cond === "cura_propria") return ctx.kit.selfHeal;
    if (e.cond === "cc_kit") return ctx.kit.cc >= 1;
    if (e.cond === "cc_inimigo") return ctx.ccIn > 0.5;
    return true;
  }
  Engine.prototype.aggregate = function (items, path, ctx) {
    const t = Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
    const itemStats = { str: 0, int: 0, pp: 0, mp: 0, hp: 0 };
    let pctAll = 0;
    const adaptInt = path === "inteligencia" || (path === "hibrido" && ctx.kit.int > ctx.kit.str);
    const addS = (s, up) => {
      for (const k in s) { if (k === "adapt_str" || k === "adapt_int") continue; if (k in t) t[k] += s[k] * up; }
      if (s.adapt_str || s.adapt_int) { if (adaptInt) t.int += (s.adapt_int || 0) * up; else t.str += (s.adapt_str || 0) * up; }
    };
    items.forEach(it => {
      addS(it.stats, 1);
      ["str", "int", "pp", "mp", "hp"].forEach(k => itemStats[k] += it.stats[k] || 0);
      if (it.stats.adapt_str || it.stats.adapt_int) { if (adaptInt) itemStats.int += it.stats.adapt_int || 0; else itemStats.str += it.stats.adapt_str || 0; }
      if (it.stats.item_stats_pct) pctAll += it.stats.item_stats_pct;
      (it.efeitos || []).forEach(e => { if (e.t === "stats" && condOk(e, ctx)) addS(e.s, (e.up_role && e.up_role[ctx.role] != null ? e.up_role[ctx.role] : (e.up ?? 1)) * (e.cond === "cc_inimigo" ? Math.min(1.5, ctx.ccIn / 3) : 1)); });
    });
    if (ctx.g && ctx.g.id === "aladdin") pctAll += 12; // Genie's Lamp: +0.6%/nível dos stats de itens (OB24), ranhura de consumível
    if (pctAll) for (const k of ["str", "int", "ad", "hp", "pp", "mp"]) { t[k] *= 1 + pctAll / 100; itemStats[k] = (itemStats[k] || 0) * (1 + pctAll / 100); }
    items.forEach(it => (it.efeitos || []).forEach(e => { if (e.t === "conv_int") { t.ad += t.int * e.ad; t.as_pct += t.int * e.as_pct; } }));
    // Book of Thoth / Transcendence: % da mana de itens (já com as stacks de Mana Infusion e a evolução)
    const mc = []; items.forEach(it => (it.efeitos || []).forEach(e => { if (e.t === "mana_conv") mc.push(e); }));
    if (mc.length) { const itemMana = t.mana + mc.reduce((a, e) => a + e.mana, 0); mc.forEach(e => { t[e.stat] += itemMana * e.pct / 100; }); t.mana = itemMana; }
    if (t.int_itens_pct) t.int += itemStats.int * t.int_itens_pct / 100;
    kitBuffs(ctx.kit, t);
    t.str *= 1 + t.str_pct / 100; t.int *= 1 + t.int_pct / 100;
    t.itemStats = itemStats;
    return t;
  };

  const GENERIC = [{ nome: "alvo genérico", tipo: "fisico", hp: 2900, hpBase: 2300, hpItem: 600, pp: 80, mp: 80, heal: 0, shield: 0, wOff: 1 }];
  Engine.prototype.evaluate = function (items, path, ctx) {
    const { g, kit } = ctx;
    const st = this.aggregate(items, path, ctx);
    const fx = []; items.forEach(it => (it.efeitos || []).forEach(e => { if (condOk(e, ctx)) fx.push(Object.assign({ _it: it.id }, e)); }));
    const sum = (t, f) => fx.filter(e => e.t === t).reduce((a, e) => a + f(e), 0);
    const maxOf = (t) => fx.filter(e => e.t === t).reduce((a, e) => Math.max(a, e.pct * (e.up ?? 1)), 0);
    // CC e slows recebidos
    const ten = Math.min(st.tenacity, 60) / 100;
    const blocks = sum("cc_block", e => e.inst) * ctx.ccMed;
    const antiDesl = Math.min(1, sum("anti_desloc", e => e.up));
    const ccEff = Math.max(0, (ctx.ccIn - ctx.deslIn * antiDesl) * (1 - ten) - blocks);
    const ccFactor = 1 - Math.min(0.5, ccEff / W);
    const slowImm = Math.min(1, sum("imune_slow", e => e.up));
    const slowFrac = Math.min(1, ctx.slowIn / W + ctx.rootIn / W) * (1 - slowImm) * (1 - ten * 0.5);
    // cooldowns e ataques
    let cdr = st.cdr + sum("cdr", e => e.pct);
    const AS = Math.min(2.5, 1.0 * (1 + (28 + st.as_pct) / 100));
    const up = ((BA_UP[ctx.role] || 0.45) + sum("ba_up", e => e.pct) / 100) * (1 - slowFrac * (kit.ranged ? 0.2 : 0.5));
    const atkRate = AS * up;
    const cdrHit = sum("cdr_hit", e => e.s);
    if (cdrHit) cdr += Math.min(20, cdrHit * atkRate * 100 / 12);
    cdr = Math.min(cdr, 40) / 100;
    let protRedPct = 0, protRedFlat = 0, amp = 0, baAmp = 0, abAmp = 0, baPen = 0;
    const critDmg = 0.75 + st.crit_dmg / 100;
    fx.forEach(e => {
      if (e.t === "debuff") { protRedPct += (e.prot_red_pct || 0) * (e.up ?? 1); protRedFlat += ((e.pp_red || 0) + (e.mp_red || 0)) / 2 * (e.up ?? 1); }
      if (e.t === "amp") amp += e.pct * (e.up ?? 1);
      if (e.t === "ba_amp" && (!e.so_ranged || kit.ranged)) baAmp += ((!kit.ranged && e.pct_melee) ? e.pct_melee : e.pct) * (e.up ?? 1);
      if (e.t === "ab_amp") abAmp += e.pct;
      if (e.t === "ba_pen") baPen += e.pct;
    });
    let antiHeal = maxOf("anti_heal");
    const antiShield = maxOf("anti_escudo");
    kit.ab.forEach(a => { if (a.debuff) { const u = kitDebuffUp(a);
      protRedFlat += (a.debuff.prot_red || 0) * u + ((a.debuff.pp_red || 0) + (a.debuff.mp_red || 0)) / 2 * u; amp += (a.debuff.amp_pct || 0) * u;
      if (a.debuff.anti_heal_pct) antiHeal = Math.max(antiHeal, a.debuff.anti_heal_pct * u); } });
    // dano bruto (antes de mitigação)
    const mg = e => e.magico ? 1 - ctx.fisIn : 1;
    const ref = { hab: sum("refund", e => e.hab * mg(e)), ult: sum("refund", e => e.ult * mg(e)) }, ultCdr = sum("ult_cdr", e => e.pct);
    const ba = kit.ba, adTot = (g.ad20 || this.adMed) + st.ad;
    const perHit = adTot * (ba.ad ?? 100) / 100 + st.str * (ba.str ?? 100) / 100 + st.int * (ba.int ?? 20) / 100;
    const crit = Math.min(st.crit_pct, 100) / 100;
    const targets = ctx.en.length ? ctx.en : GENERIC;
    /* Dano numa janela de tau segundos: as habilidades abrem a luta (todas prontas), os ataques básicos são contínuos.
       Se morrer antes dos 20s, só conta o que fez até lá — o burst de habilidades pesa mais, o dano contínuo menos. */
    const offense = (tau, tgts, refl) => {
    tgts = tgts || targets; refl = refl || { ba: ctx.incBA * ctx.xp, ab: ctx.incAb * ctx.xp };
    const attacks = atkRate * tau;
    let abil = 0, nCasts = 0;
    kit.ab.forEach(a => {
      if (!a.dano && !a.str && !a.int) return;
      const n = casts(a, cdr, ref, ultCdr, tau); nCasts += a.ult ? 0 : n;
      abil += n * HIT_AB * (a.aoe ? 1 + AOE_EXTRA : 1) * (a.dano + a.str / 100 * st.str + a.int / 100 * st.int);
    });
    const extra = sum("extra_cast", e => e.n);
    if (extra) { const best = kit.ab.filter(a => !a.ult).map(a => a.dano + a.str / 100 * st.str + a.int / 100 * st.int).sort((a, b) => b - a)[0] || 0; abil += extra * HIT_AB * best; nCasts += extra; }
    abil *= 1 + abAmp / 100;
    const baRaw = attacks * perHit * (1 + crit * critDmg) * (1 + baAmp / 100);
    let prog = 0, wsum = 0, tot = 0, sAb = 0, sBa = 0, sIt = 0, healCut = 0, shieldCut = 0; const contrib = {};
    tgts.forEach(e => {
      const mitFor = (prot, extraPen) => {
        const p = Math.max(0, prot * (1 - protRedPct / 100) - protRedFlat);
        return 100 / (100 + Math.max(0, p * (1 - Math.min(st.pen_pct + extraPen, 60) / 100) - st.pen));
      };
      const protK = kit.tipo === "magico" ? e.mp : e.pp;
      const mA = mitFor(protK, 0), mB = mitFor(protK, baPen), mF = mitFor(e.pp, 0), mM = mitFor(e.mp, 0);
      const tm = e.hp;
      const hitVal = x => (x.base || 0) + (x.str || 0) / 100 * st.str + (x.int || 0) / 100 * st.int + (x.ad || 0) / 100 * adTot
        + (x.prot_itens || 0) / 100 * (st.itemStats.pp + st.itemStats.mp) + (x.prot_total || 0) / 100 * (st.pp + st.mp + (g.pp20 || 60) + (g.mp20 || 50))
        + (x.hp_self || 0) / 100 * ((g.hp20 || 2200) + st.hp) + (x.hp_itens || 0) / 100 * st.itemStats.hp
        + (x.tgt_base || 0) / 100 * e.hpBase + (x.tgt_item || 0) / 100 * e.hpItem + (x.tgt_max || 0) / 100 * tm + (x.tgt_cur || 0) / 100 * tm * 0.7
        + (x.tgt_max_por_str || 0) * st.str / 100 * tm
        + (x.ba_pct ? ((!kit.ranged || !x.ba_pct_ranged) ? x.ba_pct : x.ba_pct_ranged) / 100 * perHit : 0)
        + (x.ba_pct_por_as || 0) / 100 * perHit * AS;
      let it = 0;
      fx.forEach(x => {
        let n = 0, v;
        if (x.t === "hit") n = attacks / (x.cada || 1) * (x.up ?? 1);
        else if (x.t === "hab") n = nCasts * HIT_AB / (x.cada || 1);
        else if (x.t === "ativo") n = x.cd >= tau ? Math.min(1, FIGHT_EVERY / x.cd) : 1 + tau / x.cd; // ativos longos: só em parte das lutas
        else if (x.t === "reflect") { v = (refl.ba * x.ba + refl.ab * x.ab) / 100 / W * x.dur * Math.min(1, FIGHT_EVERY / x.cd) / ENGAGED; /* reflete para quem bate: um dos inimigos */ v *= mF; it += v; contrib[x._it] = (contrib[x._it] || 0) + v * e.wOff; return; }
        else if (x.t !== "dps") return;
        if (x.t === "dps") v = Math.min(x.cap || 1e9, (x.base || 0) + (x.tgt_max || 0) / 100 * tm) * tau * (x.up ?? 1);
        else { if (x.proc_ba) n = Math.min(n, attacks); if (x.cd && x.t !== "ativo") n = Math.min(n, tau / x.cd + 1); v = (n + (x.seguinte_pct || 0) / 100 * Math.max(0, n - 1)) * hitVal(x); }
        v *= x.dmg === "true" ? 1 : x.dmg === "mag" ? mM : x.dmg === "fis" ? mF : mA;
        it += v; contrib[x._it] = (contrib[x._it] || 0) + v * e.wOff;
      });
      const k = (1 + amp / 100) * ccFactor;
      const d = (abil * mA + baRaw * mB + it) * k;
      const effHp = e.hp + e.shield * (1 - antiShield / 100) + e.heal * (1 - antiHeal / 100);
      prog += e.wOff * d / effHp; wsum += e.wOff; tot += e.wOff * d;
      sAb += e.wOff * abil * mA * k; sBa += e.wOff * baRaw * mB * k; sIt += e.wOff * it * k;
      healCut += e.heal * antiHeal / 100; shieldCut += e.shield * antiShield / 100;
    });
    Object.keys(contrib).forEach(k => contrib[k] /= wsum);
    return { total: tot / wsum, off: prog / wsum, abil: sAb / wsum, ba: sBa / wsum, itens: sIt / wsum, contrib, healCut, shieldCut, nCasts, attacks };
    };
    const full = offense(W), total = full.total, offFull = full.off, nCasts = full.nCasts, attacks = full.attacks;
    // sobrevivência contra o dano simulado dos inimigos
    const hp = (g.hp20 || 2200) + st.hp;
    const pp = ((g.pp20 || 60) + st.pp) * (1 + st.prot_pct / 100), mp = ((g.mp20 || 50) + st.mp) * (1 + st.prot_pct / 100);
    let heal = st.ls_pct / 100 * total * 0.8 + st.hp5 / 5 * W, shield = 0, enemyRed = 0;
    kit.ab.forEach(a => {
      const n = casts(a, cdr, ref, ultCdr, W);
      if (a.cura) heal += n * (a.cura.base + (a.cura.str || 0) / 100 * st.str + (a.cura.int || 0) / 100 * st.int);
      if (a.escudo) shield += (a.ult ? 1 : Math.min(n, 2)) * (a.escudo.base + (a.escudo.str || 0) / 100 * st.str + (a.escudo.int || 0) / 100 * st.int);
      if (a.debuff && a.debuff.enemy_dmg_red_pct) enemyRed += a.debuff.enemy_dmg_red_pct * kitDebuffUp(a);
    });
    let asRed = 0, asRedT = 0, physRed = 0, critRed = 0, baRed = 0, imune = 0;
    kit.ab.forEach(a => { if (a.debuff && a.debuff.enemy_as_red_pct) asRed += a.debuff.enemy_as_red_pct * kitDebuffUp(a); });
    fx.forEach(e => {
      const n = e.cd ? (e.cd >= W ? Math.min(1, FIGHT_EVERY / e.cd) : W / e.cd) : 1;
      if (e.t === "cura") heal += (e.hit_maxhp || 0) / 100 * hp * attacks + (e.hab_maxhp || 0) / 100 * hp * nCasts + (e.hab_flat || 0) * (e.cd ? Math.min(nCasts, W / e.cd + 1) : nCasts)
        + (e.flat || 0) * n + (e.maxhp || 0) / 100 * hp * n + (e.per_s_maxhp || 0) / 100 * hp * W;
      if (e.t === "escudo") { let v = (e.base || 0) + (e.maxhp || 0) / 100 * hp + (e.str_itens || 0) / 100 * st.itemStats.str + (e.int_itens || 0) / 100 * st.itemStats.int + (e.prot_total || 0) / 100 * (pp + mp);
        if (e.so_magico) v *= 1 - ctx.fisIn; shield += v * Math.min(n, 1); }
      if (e.t === "debuff") { if (e.enemy_as_red) { if (e.so_alvo) asRedT += e.enemy_as_red * (e.up ?? 1); else asRed += e.enemy_as_red * (e.up ?? 1); } if (e.enemy_dmg_red) { if (e.so_fisico) physRed += e.enemy_dmg_red * (e.up ?? 1); else enemyRed += e.enemy_dmg_red * (e.up ?? 1); } }
      if (e.t === "mitig_crit") critRed = Math.max(critRed, e.pct);
      if (e.t === "ba_red") baRed += e.pct * (e.up ?? 1);
      if (e.t === "imune") imune = Math.max(imune, e.s);
    });
    // abrandar o ataque de quem nos bate (Midgardian) vale para todos; o de quem nós atacamos (Toxic Blade) só para o alvo
    const asRedAlvo = Math.min(60, asRedT);
    asRed = Math.min(asRed, 60);
    const mitig = Math.min(50, st.mitig_pct + enemyRed) / 100;
    const incoming = (srcs, duel) => {
      let inc = 0, incRaw = 0, critCut = 0, asCut = 0, physCut = 0;
      srcs.forEach(e => {
        const prot = e.tipo === "magico" ? mp : pp;
        const m = 100 / (100 + Math.max(0, prot * (1 - e.pen_pct / 100) - e.pen));
        const cC = e.critPart * critRed / 100;
        const ar = Math.min(60, asRed + asRedAlvo * (duel ? 1 : 1 / ENGAGED));
        const baLeft = (e.ba - cC) * (1 - ar / 100 * 0.9) * (1 - baRed / 100);
        let d = e.abil + baLeft;
        const pC = e.tipo === "magico" ? 0 : d * physRed / 100; d -= pC;
        critCut += cC * m * e.fIn; asCut += (e.ba - cC) * ar / 100 * 0.9 * m * e.fIn; physCut += pC * m * e.fIn;
        inc += d * m * e.fIn; incRaw += (e.abil + e.ba) * e.fIn;
      });
      return { inc: inc * (1 - mitig), incRaw, critCut, asCut, physCut };
    };
    // sem inimigos: equipa típica (ordem de grandeza da média dos kits simulados): 3 inimigos, metade físico, metade mágico
    const srcs = ctx.en.length ? ctx.en : [{ tipo: "fisico", abil: 2600, ba: 3400, critPart: 600, pen: 10, pen_pct: 10, fIn: 1.5 }, { tipo: "magico", abil: 3600, ba: 1200, critPart: 0, pen: 15, pen_pct: 10, fIn: 1.5 }];
    const IN = incoming(srcs, false);
    const xp = ctx.xp ?? (EXPOSE[ctx.role] || 1) * +(globalThis.__XP || 1);
    let inc = IN.inc * xp, incRaw = IN.incRaw * xp; const critCut = IN.critCut, asCut = IN.asCut, physCut = IN.physCut;
    // tempo até morrer: vida + escudos contra (dano recebido/s − cura/s); a cura nunca anula mais de 75% do dano
    const incR = Math.max(1, inc) / W, healR = heal * (1 - ctx.antiHealIn / 100) / W;
    const T = Math.min(60, (hp + shield) / Math.max(incR - healR, incR * 0.25) + imune * 2);
    const ehp = T * incRaw / W;
    // só causa dano enquanto está vivo: conta o que faz até min(T, 20s)
    const tau = Math.min(W, T), O = tau >= W ? full : offense(tau);
    const off = O.off, alive = tau / W, contrib = O.contrib, healCut = O.healCut, shieldCut = O.shieldCut;
    // duelo de lane (Solo): progresso para matar o adversário da lane antes de morrer para ele
    let duel = 0;
    if (DUEL_W[ctx.role]) {
      const L = ctx.laneEn || this.genericLane;
      const pl = offense(W, [L], { ba: L.ba, ab: L.abil }).off;
      const il = incoming([Object.assign({}, L, { fIn: 1 })], true).inc;
      const iR = Math.max(1, il) / W, Tl = Math.min(60, (hp + shield) / Math.max(iR - healR, iR * 0.25) + imune);
      duel = pl * Tl / W;
    }
    let aura = 0;
    fx.forEach(e => { if (e.t === "aura") { const n = e.para === "ataque_basico" ? ctx.allyBA : ctx.allyN; aura += n * ((e.s.as_pct || 0) / 20 + ((e.s.str || 0) + (e.s.int || 0)) / 40) * (e.up ?? 1); }
      if (e.t === "suporte") aura += ctx.role === "Support" ? 0.6 : 0.15; });
    return { total, off, offFull, alive, T, ehp, duel, inc, abil: O.abil, ba: O.ba, itens: O.itens, heal, shield, aura, st, contrib, as: AS, attacks,
      mech: { antiHeal, antiShield, healCut, shieldCut, critCut, asCut, physCut, ccEff, ccFactor, slowFrac, pp, mp } };
  };

  /* ---------- caminhos ---------- */
  Engine.prototype.paths = function (kit) {
    const tot = kit.str + kit.int, p = [];
    if (kit.str > 0 || !tot) p.push("forca");
    if (kit.int > 0) p.push("inteligencia");
    p.push("ataque");
    if (tot && kit.str / tot >= 0.3 && kit.int / tot >= 0.3) p.push("hibrido");
    return p;
  };
  function allowed(it, path, g) {
    const s = it.stats;
    if (!g.usa_mana && (it.depende_mana || it.id === "sun_beam_bow" || ((s.mana || s.mp5) && !s.str && !s.int && !s.ad && !s.adapt_str && !s.pp && !s.mp && !s.hp && !s.as_pct))) return false;
    const off = (s.str || 0) + (s.int || 0) + (s.ad || 0) + (s.as_pct || 0) + (s.crit_pct || 0);
    if (!off) return true;
    if (s.adapt_str || s.adapt_int) return true;
    if (path === "forca") return !!(s.str || s.ad || s.crit_pct) || (s.as_pct && !s.int);
    if (path === "inteligencia") return !!s.int || (!s.str && !s.ad && !s.crit_pct && !s.as_pct);
    if (path === "ataque") return !!(s.ad || s.as_pct || s.crit_pct || s.str);
    return true;
  }

  /* Como é que esse deus costuma ser jogado nesse role (dados de jogo): quanto das builds é defesa pura.
     Serve para prever o que os outros vão fazer (aliados e inimigos), não para escolher a minha build. */
  Engine.prototype.estStyle = function (gid, role) {
    const CM = this.data.comunidade; const c = CM && CM.deuses[gid]; if (!c) return null;
    const src = (role && c.por_role && c.por_role[role] && c.por_role[role].jogos >= 5) ? c.por_role[role] : (c.role === role || !role ? c : null);
    if (!src) return null;
    let def = 0, tot = 0;
    Object.entries(src.itens).forEach(([id, d]) => { const it = this.items[id]; if (!it) return; tot += d.pick; if (pureDef(it)) def += d.pick; });
    if (!tot) return null;
    const sh = def / tot;
    return sh >= 0.6 ? ["tank"] : sh >= 0.3 ? ["bruiser"] : null;
  };
  /* A equipa adversária: quanto dano traz e quanto aguenta, comparado com uma equipa típica com os mesmos roles.
     Muito dano inimigo → vale mais aguentar; inimigos muito resistentes e com pouco dano → vale mais dano (e penetração,
     que a simulação já escolhe item a item). */
  Engine.prototype.enemyNeed = function (en, modo) {
    if (!en.length) return null;
    let dmg = 0, ehp = 0, refD = 0, refE = 0, burst = 0;
    en.forEach(e => { dmg += e.total; ehp += e.hp * (1 + (e.pp + e.mp) / 200); const r = this.roleRef(e.role || "Mid"); refD += r.dmg; refE += r.ehp; });
    const dmgRatio = dmg / refD, ehpRatio = ehp / refE, conf = Math.min(1, en.length / (TEAM_N[modo] || 5));
    const ajuste = Math.max(-0.3, Math.min(0.3, 0.5 * ((ehpRatio - 1) - (dmgRatio - 1)))) * conf;
    const notas = [];
    if (dmgRatio > 1.1) notas.push(L(`traz ${Math.round((dmgRatio - 1) * 100)}% mais dano do que uma equipa típica com estes roles`, `brings ${Math.round((dmgRatio - 1) * 100)}% more damage than a typical team with these roles`));
    if (dmgRatio < 0.9) notas.push(L(`traz ${Math.round((1 - dmgRatio) * 100)}% menos dano do que o típico`, `brings ${Math.round((1 - dmgRatio) * 100)}% less damage than typical`));
    if (ehpRatio > 1.1) notas.push(L(`aguenta ${Math.round((ehpRatio - 1) * 100)}% mais (vida efetiva) do que o típico`, `is ${Math.round((ehpRatio - 1) * 100)}% tankier (effective health) than typical`));
    if (ehpRatio < 0.9) notas.push(L(`aguenta ${Math.round((1 - ehpRatio) * 100)}% menos do que o típico`, `is ${Math.round((1 - ehpRatio) * 100)}% squishier than typical`));
    return { dmgRatio, ehpRatio, ajuste, notas, n: en.length };
  };
  /* As três leituras lado a lado (otimizado, dano, resistência): cada build é avaliada também com o peso do mix,
     para se ver quanto se perde (ou ganha) ao seguir só uma leitura. */
  Engine.prototype.leituras = function (opt) {
    const LL = [["otimizado", L("Otimizado", "Optimised")], ["dano", L("Dano", "Damage")], ["resistencia", L("Resistência", "Durability")]];
    const ctxMix = Object.assign({}, this.ctx(Object.assign({}, opt, { objetivo: undefined })), { bonusByPath: null });
    const out = LL.map(([k, nome]) => {
      const o = Object.assign({}, opt, { objetivo: k === "otimizado" ? undefined : k });
      const r = this.recommend(o), b = r.builds[0];
      const vMix = this.score(b.itens, b.caminho, ctxMix);
      return { k, nome, wo: r.ctx.wo, itens: b.itens.map(i => i.nome), caminho: b.caminho, vMix: vMix.val, off: vMix.ev.off, T: vMix.ev.T };
    });
    const best = out[0].vMix;
    out.forEach(x => x.rel = Math.round(x.vMix / best * 100));
    return out;
  };
  Engine.prototype.roleRef = function (role) {
    this._roleRef = this._roleRef || {};
    if (this._roleRef[role]) return this._roleRef[role];
    let n = 0, dmg = 0, ehp = 0;
    Object.values(this.gods).forEach(g => { const e = this.enemies([{ id: g.id, role }], null)[0]; if (!e || !e.total) return; n++; dmg += e.total; ehp += e.hp * (1 + (e.pp + e.mp) / 200); });
    return this._roleRef[role] = { dmg: dmg / (n || 1), ehp: ehp / (n || 1) };
  };
  Engine.prototype.teamNeed = function (allies, opt) {
    if (!allies.length) return null;
    const al = this.enemies(allies, null);
    let dmg = 0, mag = 0, ehp = 0, refD = 0, refE = 0;
    al.forEach(e => { dmg += e.total; if (e.tipo === "magico") mag += e.total; ehp += e.hp * (1 + (e.pp + e.mp) / 200);
      const r = this.roleRef(e.role || "Mid"); refD += r.dmg; refE += r.ehp; });
    const dmgRatio = dmg / refD, frontRatio = ehp / refE, magShare = dmg ? mag / dmg : 0.5;
    // diferença entre o que falta de dano e o que falta de frente, limitada; com menos aliados escolhidos, efeito menor
    const conf = Math.min(1, al.length / Math.max(1, (TEAM_N[opt.modo] || 5) - 1));
    // o tipo de dano que eu trago e que falta à equipa vale mais (os inimigos não conseguem empilhar só um tipo de proteção)
    const meuMag = this.godKit(this.gods[opt.god], opt.aspeto).tipo === "magico";
    const falta = meuMag ? 1 - magShare : magShare; // parte do dano da equipa que já é do meu tipo
    const tipoBonus = (meuMag ? magShare : 1 - magShare) < 0.25 ? 0.12 : 0;
    const ajuste = Math.max(-0.35, Math.min(0.4, 0.5 * ((frontRatio - 1) - (dmgRatio - 1)) + tipoBonus)) * conf;
    // tipo de dano: se a equipa já é quase toda de um tipo, o caminho do outro tipo ganha um pequeno bónus (só desempata caminhos que o kit permite)
    const pathBias = { forca: 0, ataque: 0, inteligencia: 0, hibrido: 0 };
    if (magShare < 0.35) pathBias.inteligencia = 0.06 * conf; else if (magShare > 0.65) { pathBias.forca = 0.06 * conf; pathBias.ataque = 0.06 * conf; }
    const notas = [];
    if (dmgRatio < 0.85) notas.push(L(`a tua equipa traz ${Math.round((1 - dmgRatio) * 100)}% menos dano do que uma equipa típica com estes roles`, `your team brings ${Math.round((1 - dmgRatio) * 100)}% less damage than a typical team with these roles`));
    if (dmgRatio > 1.15) notas.push(L(`a tua equipa já traz ${Math.round((dmgRatio - 1) * 100)}% mais dano do que o típico`, `your team already brings ${Math.round((dmgRatio - 1) * 100)}% more damage than typical`));
    if (frontRatio < 0.85) notas.push(L(`tem ${Math.round((1 - frontRatio) * 100)}% menos vida efetiva do que o típico (pouca linha da frente)`, `it has ${Math.round((1 - frontRatio) * 100)}% less effective health than typical (thin frontline)`));
    if (frontRatio > 1.15) notas.push(L(`tem ${Math.round((frontRatio - 1) * 100)}% mais vida efetiva do que o típico`, `it has ${Math.round((frontRatio - 1) * 100)}% more effective health than typical`));
    if (magShare < 0.35) notas.push(L(`o dano dela é ${Math.round((1 - magShare) * 100)}% físico`, `its damage is ${Math.round((1 - magShare) * 100)}% physical`));
    if (magShare > 0.65) notas.push(L(`o dano dela é ${Math.round(magShare * 100)}% mágico`, `its damage is ${Math.round(magShare * 100)}% magical`));
    if (tipoBonus) notas.push(L(`quase não tem dano ${meuMag ? "mágico" : "físico"}: o teu dano vale mais, porque os inimigos não podem empilhar só um tipo de proteção`, `it has almost no ${meuMag ? "magical" : "physical"} damage: yours is worth more, because enemies cannot stack just one protection type`));
    return { dmgRatio, frontRatio, magShare, ajuste, pathBias, notas, n: al.length };
  };

  Engine.prototype.ctx = function (opt) {
    const g = this.gods[opt.god];
    const kit = this.godKit(g, opt.aspeto);
    const en = this.enemies(opt.inimigos || [], opt.role);
    const allies = (opt.aliados || []).map(x => typeof x === "string" ? { id: x } : x).filter(x => this.gods[x.id]);
    const allyBA = allies.filter(x => x.role === "Carry" || (["Jungle", "Solo"].includes(x.role) && this.gods[x.id].alcance === "ranged")).length;
    let [wo, wd] = ROLE_W[opt.role] || [0.6, 0.4];
    /* A minha equipa: o que já traz de dano (e de que tipo) e de linha da frente, comparado com o que uma equipa típica
       com esses roles traz. Falta dano → a build puxa para dano; falta quem aguente → puxa para resistência. Sem lista de compras por role. */
    const equipa = this.teamNeed(allies, opt);
    const adversaria = this.enemyNeed(en, opt.modo);
    /* objetivos: "equipa" (o que falta à minha equipa), "adversaria" (o que a equipa inimiga ameaça e aguenta),
       "dano", "resistencia"; sem objetivo = otimizado: soma das leituras da equipa e da adversária */
    const obj = opt.objetivo || "otimizado";
    const aT = equipa ? equipa.ajuste : 0, aE = adversaria ? adversaria.ajuste : 0;
    const adj = obj === "equipa" ? aT : obj === "adversaria" ? aE : obj === "otimizado" ? aT + aE : 0;
    if (adj) { wo = Math.min(0.95, Math.max(0.1, wo + adj)); wd = 1 - wo; }
    if (opt.objetivo === "dano") { wo = wo + (1 - wo) * 0.6; wd = 1 - wo; } else if (opt.objetivo === "resistencia") { wo = wo * 0.5; wd = 1 - wo; }
    /* foco recebido: Duel = o único inimigo bate só em si; Joust = menos alvos, foco ×5/3 (até 1,5); 5v5 = calibrado por role.
       Depois o objetivo mexe-lhe (Otimizado: dano inimigo; Dano: metade; Resistência: ×1,5 com mínimo 0,9) — no Duel fica 1. */
    const xp0 = opt.modo === "Joust" ? Math.min(1.5, (EXPOSE[opt.role] || 1) * 5 / 3) : (EXPOSE[opt.role] || 1);
    const xpBase = (opt.modo === "Duel" ? 1 : obj === "resistencia" ? Math.max(xp0 * RES_XP_K, RES_XP_MIN) : xp0 * (obj === "otimizado" && adversaria ? Math.pow(Math.max(0.8, Math.min(1.8, adversaria.dmgRatio)), OTIM_XP_POW) : obj === "dano" ? DANO_XP_K : 1)) * +(globalThis.__XP || 1);
    let ccIn = 0, deslIn = 0, rootIn = 0, slowIn = 0, fis = 0, all = 0, ccW = 0, ccM = 0, antiHealIn = 0;
    en.forEach(e => { ccIn += e.cc * e.fIn; deslIn += e.desl * e.fIn; rootIn += e.root * e.fIn; slowIn += e.slow * e.fIn;
      const d = e.total * e.fIn; all += d; if (e.tipo !== "magico") fis += d; if (e.cc) { ccW += e.cc; ccM += e.ccMed * e.cc; } antiHealIn = Math.max(antiHealIn, e.antiHeal); });
    if (!en.length) { ccIn = 3; fis = all = 1; }
    const incBA = en.length ? en.reduce((a, e) => a + e.ba * e.fIn, 0) : 4600 * 1.5, incAb = en.length ? en.reduce((a, e) => a + e.abil * e.fIn, 0) : 6200 * 1.5;
    const laneEn = en.find(e => e.lane) || null;
    const pr = opt.semDados ? null : this.prior(opt);
    return { equipa, adversaria, objetivo: obj, pathBias: equipa && (obj === "otimizado" || obj === "equipa") ? equipa.pathBias : null, g, kit, en, laneEn, bonusByPath: pr ? pr.byPath : null, fontePrior: pr ? pr.fonte : null, role: opt.role, wo, wd, allyBA, allyN: allies.length, ccIn, deslIn, rootIn, slowIn, ccMed: ccW ? ccM / ccW : 1.1,
      fisIn: all ? fis / all : 0.5, antiHealIn, incBA, incAb, xp: xpBase, perfil: this.profile(en) };
  };

  /* Ouro: os itens não custam todos o mesmo. Um item 40% mais caro chega mais tarde e atrasa os seguintes;
     penalização linear no custo acima/abaixo do custo mediano de um tier 3 (2550). */
  const GOLD_REF = 2550, GOLD_K = +(globalThis.__GK ?? 0);
  /* Tempo de compra. Fonte: notas OB5 ("um item tier 3 a cada 5 minutos em média") e OB9 (ouro um pouco mais rápido);
     ouro inicial de Conquest 1250 (CA1). ~530 de ouro por minuto em média (dado pelo Micael; a OB5 apontava ~510). Duração média da partida: 30 min (dado pelo Micael).
     A nota da build é a média, ao longo da partida, da nota do que já se comprou: itens caros chegam mais tarde
     e atrasam os seguintes; uma build barata e funcional fica completa mais cedo. */
  const GPM = +(globalThis.__GPM ?? 530), START_GOLD = 1250, T_END = +(globalThis.__TEND ?? 30), TEMPO = (globalThis.__TEMPO ?? 1) ? 1 : 0;
  Engine.prototype.score = function (items, path, ctx, cache) {
    if (!TEMPO || ctx.semTempo || items.length < 2) return this.score1(items, path, ctx, cache);
    const full = this.score1(items, path, ctx, cache);
    /* ordem de compra para a linha do tempo: depois do starter, primeiro o que mais rende por cada moeda de ouro
       (ganho do item sozinho com o starter, a dividir pelo custo; guardado por item e caminho) */
    const st = items[0].tier === "starter_upgrade" ? items[0] : null;
    if (st) {
      const memo = ctx._solo || (ctx._solo = {}), key = path + "|" + st.id;
      const m = memo[key] || (memo[key] = { base: this.score1([st], path, ctx, cache).val });
      const g = it => m[it.id] ?? (m[it.id] = (this.score1([st, it], path, ctx, cache).val - m.base) / Math.max(1, it.custo || 2500));
      items = [st].concat(items.slice(1).sort((a, b) => g(b) - g(a)));
    }
    /* entre dois itens completos, os componentes (tier 1 e 2) já dão parte dos stats: a nota sobe em linha reta
       do item anterior para o seguinte, à medida que o ouro entra; o item que fica a meio no fim da partida conta em parte */
    let cum = 0, acc = 0, prevT = 0, prevV = null;
    for (let k = 0; k < items.length; k++) {
      cum += items[k].custo || 0;
      const tRaw = Math.max(0, cum - START_GOLD) / GPM;
      const v = k === items.length - 1 ? full.val : this.score1(items.slice(0, k + 1), path, ctx, cache).val;
      if (prevV === null) { prevV = v; prevT = Math.min(T_END, tRaw); continue; }
      if (tRaw <= T_END) { acc += (prevV + v) / 2 * (tRaw - prevT); prevT = tRaw; prevV = v; }
      else { const f = (T_END - prevT) / Math.max(1e-9, tRaw - prevT), vEnd = prevV + (v - prevV) * f; acc += (prevV + vEnd) / 2 * (T_END - prevT); prevT = T_END; prevV = vEnd; break; }
    }
    acc += prevV * (T_END - prevT);
    return { val: acc / T_END, ev: full.ev, cheio: full.val, completo: Math.min(T_END, Math.max(0, cum - START_GOLD) / GPM) };
  };
  Engine.prototype.score1 = function (items, path, ctx, cache) {
    const ev = this.evaluate(items, path, ctx);
    const base = cache || this.evaluate([], path, ctx);
    const val = ctx.wo * Math.log(ev.off / Math.max(1e-9, base.off)) + ctx.wd * Math.log(Math.min(ev.T, 30) / Math.min(base.T, 30)) + 0.03 * ev.aura
      + (DUEL_W[ctx.role] ? DUEL_W[ctx.role] * Math.log(Math.max(1e-6, ev.duel) / Math.max(1e-6, base.duel)) : 0)
      + (ctx.pathBias ? ctx.pathBias[path] || 0 : 0)
      - GOLD_K * items.reduce((a, i) => a + (i.tier === "tier3" && i.custo ? (i.custo - GOLD_REF) / GOLD_REF : 0), 0)
      + (ctx.bonusByPath && ctx.bonusByPath[path] ? LAMBDA_DADOS * items.reduce((a, i) => a + (ctx.bonusByPath[path][i.id] || 0), 0) : 0);
    return { val, ev };
  };

  Engine.prototype.godItems = function (opt) {
    return (this.data.itens_deus || []).filter(x => x.deus === opt.god).map(x => {
      const v = opt.aspeto ? x.aspeto : x.base;
      return { id: x.id, nome: x.nome, tier: "deus", custo: x.custo, stats: v.stats, efeitos: v.efeitos, tags: [], ativo: false, confianca: "pista",
        divergencias: 0, exclusivo: true, variante: opt.aspeto ? "aspeto" : "base" };
    });
  };
  Engine.prototype.build = function (opt, path, ctx) {
    const g = ctx.g, base = this.evaluate([], path, ctx);
    const pool = this.data.itens.filter(i => i.tier === "tier3" && allowed(i, path, g)).concat(this.godItems(opt));
    let best = null; const starterCands = [];
    (STARTERS[opt.role] || []).forEach(sid => {
      const up = this.items[UPG[sid]]; if (!up || !allowed(up, path, g)) return; starterCands.push(up);
      let v = this.score([up], path, ctx, base).val;
      if (!best || v > best.v) best = { v, up };
    });
    if (!best) (STARTERS[opt.role] || []).forEach(sid => { const up = this.items[UPG[sid]]; if (!up) return; starterCands.push(up); const v = this.score([up], path, ctx, base).val; if (!best || v > best.v) best = { v, up }; });
    const chosen = best ? [best.up] : [], why = {};
    if (best) why[best.up.id] = [L(`Starter de ${opt.role}: o que mais rende neste caminho contra esta equipa, contando a passiva.`, `${opt.role} starter: the best value on this path against this team, counting its passive.`)];
    const nStarter = chosen.length;
    while (chosen.length < nStarter + 6) {
      const cur = this.score(chosen, path, ctx, base);
      let top = null;
      for (const it of pool) {
        if (chosen.includes(it)) continue;
        if (it.ativo && chosen.filter(c => c.ativo).length >= 3) continue;
        if (pureDef(it) && chosen.slice(nStarter).filter(pureDef).length >= (MAX_PURE_DEF[opt.role] ?? 6)) continue;
        if (it.unico && chosen.some(c => c.unico === it.unico)) continue;
        const sc = this.score(chosen.concat(it), path, ctx, base);
        const d = sc.val - cur.val;
        if (!top || d > top.d) top = { it, d, sc, cur };
      }
      if (!top) break;
      chosen.push(top.it);
      why[top.it.id] = this.explain(top, ctx);
    }
    /* Melhoria local: o guloso escolhe item a item a partir de uma build vazia e favorece itens de valor fixo;
       aqui troca-se cada ranhura pelo item que mais melhora a build final, até não haver melhoria. */
    const okWith = (set, it) => !set.includes(it) && !(it.ativo && set.filter(c => c.ativo).length >= 3)
      && !(pureDef(it) && set.slice(nStarter).filter(pureDef).length >= (MAX_PURE_DEF[opt.role] ?? 6))
      && !(it.unico && set.some(c => c.unico === it.unico));
    let curVal = this.score(chosen, path, ctx, base).val, changed = true, pass = 0;
    while (changed && pass++ < 4) {
      changed = false;
      for (let k = nStarter; k < chosen.length; k++) {
        const rest = chosen.filter((_, j) => j !== k);
        let bestIt = null, bestV = curVal + 1e-4;
        for (const it of pool) { if (!okWith(rest, it)) continue; const v = this.score(rest.concat(it), path, ctx, base).val; if (v > bestV) { bestV = v; bestIt = it; } }
        if (bestIt) { chosen[k] = bestIt; curVal = bestV; changed = true; }
      }
      /* o starter também se revê com o resto da build já escolhida: sozinho, um starter com proteções planas parece
         sempre melhor; com 6 itens à volta, conta o que acrescenta a ESTE deus contra ESTA equipa */
      if (nStarter) {
        const rest = chosen.slice(1);
        starterCands.forEach(up => { if (up === chosen[0]) return; const v = this.score([up].concat(rest), path, ctx, base).val; if (v > curVal + 1e-4) { chosen[0] = up; curVal = v; changed = true; } });
      }
    }
    if (nStarter && starterCands.length > 1) {
      const rest = chosen.slice(1), vals = starterCands.map(up => ({ up, v: this.score([up].concat(rest), path, ctx, base) })).sort((a, b) => b.v.val - a.v.val);
      const a = vals[0], b2 = vals[1];
      if (a && b2 && a.up === chosen[0]) {
        const dO = (a.v.ev.off / b2.v.ev.off - 1) * 100, dT = (Math.min(a.v.ev.T, 30) / Math.min(b2.v.ev.T, 30) - 1) * 100;
        const parts = [];
        if (Math.abs(dO) >= 1) parts.push(`${dO > 0 ? "+" : ""}${dO.toFixed(0)}%` + L(" de progresso para matar", " kill progress"));
        if (Math.abs(dT) >= 1) parts.push(`${dT > 0 ? "+" : ""}${dT.toFixed(0)}%` + L(" de tempo vivo", " time alive"));
        why[chosen[0].id] = [L(`Starter escolhido com a build completa à volta, contra esta equipa: frente a ${b2.up.nome} dá ${parts.join(" e ") || "quase o mesmo"}.`, `Starter chosen with the full build around it, against this team: compared with ${b2.up.nome} it gives ${parts.join(" and ") || "about the same"}.`)];
      }
    }
    // ordem de compra: dentro da build final, o que mais rende primeiro; explicações recalculadas nessa ordem
    const finalSet = chosen.slice(nStarter), ord = chosen.slice(0, nStarter);
    Object.keys(why).forEach(k => { if (!ord.some(i => i.id === k)) delete why[k]; });
    while (finalSet.length) {
      const cur = this.score(ord, path, ctx, base);
      let top = null;
      finalSet.forEach(it => { const sc = this.score(ord.concat(it), path, ctx, base); const d = sc.val - cur.val; if (!top || d > top.d) top = { it, d, sc, cur }; });
      ord.push(top.it); finalSet.splice(finalSet.indexOf(top.it), 1); why[top.it.id] = this.explain(top, ctx);
    }
    const final = this.score(ord, path, ctx, base);
    return { caminho: path, rotulo: PL(path), itens: ord, porque: why, score: final };
  };

  const N = x => Math.round(x).toLocaleString(L("pt-PT", "en-GB"));
  const names = (arr, f) => arr.filter(f).map(e => e.nome.replace(" (aspeto)", "").replace(" (aspect)", "")).slice(0, 3).join(", ");
  Engine.prototype.explain = function (top, ctx) {
    const r = [], it = top.it, a = top.cur.ev, b = top.sc.ev, A = a.mech, B = b.mech, en = ctx.en;
    const dd = (b.off / a.off - 1) * 100, dt = (b.T / a.T - 1) * 100;
    const dFull = (b.offFull / a.offFull - 1) * 100;
    if (dd >= 2 && dFull < 1) r.push(L(`+${dd.toFixed(0)}% de dano na luta por ficar mais tempo vivo (${a.T.toFixed(1)}s → ${b.T.toFixed(1)}s até morrer).`, `+${dd.toFixed(0)}% fight damage from staying alive longer (${a.T.toFixed(1)}s → ${b.T.toFixed(1)}s until death).`));
    else if (dd >= 2) {
      const parts = [["hab", b.abil - a.abil], ["ba", b.ba - a.ba], ["it", b.itens - a.itens]].sort((x, y) => y[1] - x[1]);
      const PN = { hab: L("habilidades", "abilities"), ba: L("ataques básicos", "basic attacks"), it: L("efeitos de itens", "item effects") };
      const viaCdr = (it.stats.cdr || 0) > 0 && !(it.efeitos || []).some(e => ["hit", "hab", "ativo", "dps"].includes(e.t)) && parts[0][0] !== "ba";
      r.push(viaCdr ? L(`+${dd.toFixed(0)}% de progresso para matar: o cooldown rate dá mais habilidades e mais efeitos dos outros itens.`, `+${dd.toFixed(0)}% kill progress: cooldown rate gives more abilities and more effects from the other items.`)
        : L(`+${dd.toFixed(0)}% de progresso para matar (sobretudo ${PN[parts[0][0]]}).`, `+${dd.toFixed(0)}% kill progress (mostly ${PN[parts[0][0]]}).`));
    }
    if (B.healCut - A.healCut > 40) r.push(L(`Corta ${N(B.healCut - A.healCut)} de cura inimiga por luta (${B.antiHeal.toFixed(0)}% efetivo)`, `Cuts ${N(B.healCut - A.healCut)} enemy healing per fight (${B.antiHeal.toFixed(0)}% effective)`) + `${en.length ? ": " + names(en, e => e.heal > 150) : ""}.`);
    if (B.shieldCut - A.shieldCut > 30) r.push(L(`Retira ${N(B.shieldCut - A.shieldCut)} de escudos inimigos`, `Removes ${N(B.shieldCut - A.shieldCut)} enemy shields`) + `${en.length ? ": " + names(en, e => e.shield > 100) : ""}.`);
    if (dt >= 2) {
      const bits = [];
      if (B.critCut - A.critCut > 30) bits.push(`${N(B.critCut - A.critCut)}` + L(" a menos de críticos", " less crit damage") + ` (${names(en, e => e.critPart > 100)})`);
      if (B.asCut - A.asCut > 30) bits.push(`${N(B.asCut - A.asCut)}` + L(" a menos de ataques básicos", " less basic attack damage") + ` (${names(en, e => e.ba > 600)})`);
      if (B.physCut - A.physCut > 30) bits.push(`${N(B.physCut - A.physCut)}` + L(" a menos de dano físico", " less physical damage"));
      if (A.ccEff - B.ccEff > 0.2) bits.push(`${(A.ccEff - B.ccEff).toFixed(1)}s` + L(" a menos de CC por luta", " less CC per fight") + ` (${names(en, e => e.cc > 0.4)})`);
      const dpp = B.pp - A.pp, dmp = B.mp - A.mp;
      if (dpp >= 15 || dmp >= 15) {
        bits.push(dpp >= dmp ? L(`proteção física, contra ${Math.round(ctx.fisIn * 100)}% de dano físico`, `physical protection, against ${Math.round(ctx.fisIn * 100)}% physical damage`) : L(`proteção mágica, contra ${Math.round((1 - ctx.fisIn) * 100)}% de dano mágico`, `magical protection, against ${Math.round((1 - ctx.fisIn) * 100)}% magical damage`));
      }
      if (b.heal - a.heal > 150) bits.push(L("mais sustain", "more sustain"));
      if (b.shield - a.shield > 150) bits.push(L("escudo", "shield"));
      r.push(L(`Aguenta +${dt.toFixed(0)}% de tempo contra esta equipa`, `Survives +${dt.toFixed(0)}% longer against this team`) + (bits.length ? ": " + bits.join("; ") + "." : "."));
    }
    if (B.slowFrac < A.slowFrac - 0.05) r.push(L("Ignora os slows dos inimigos: mais tempo a atacar.", "Ignores enemy slows: more time attacking."));
    if (b.aura - a.aura > 0.2) r.push(L("A aura beneficia os aliados da equipa.", "The aura also helps your allies."));
    if (it.exclusivo) r.unshift(L(`Item exclusivo do deus (${it.variante === "aspeto" ? "valores com aspeto" : "valores base"}); stats ainda só da wiki, por confirmar no cliente.`, `God-exclusive item (${it.variante === "aspeto" ? "aspect values" : "base values"}); stats from the wiki only, not yet confirmed in the client.`));
    const notas = (it.efeitos || []).filter(e => e.nota && e.t !== "suporte").map(e => e.nota);
    if (notas.length) r.push(L("Modelo: ", "Model: ") + notas.map(n => L(n, NOTE_EN[n] || n)).join("; ") + ".");
    if (ctx.bonusByPath && Object.values(ctx.bonusByPath).some(b => b[it.id] > 0.3)) {
      const C = this.data.comunidade && this.data.comunidade.deuses[ctx.g.id], C2 = C && ctx.fontePrior === "deus-role" ? C.por_role[ctx.role] : (ctx.fontePrior === "deus" ? C : null),
        dd = C2 ? (C2.itens[it.id] || C2.starters.find(x => x.id === it.id)) : null;
      if (dd) r.push(L(`Dados de jogo: em ${dd.pick}% das builds de jogadores Master+ deste deus${ctx.fontePrior === "deus-role" ? " no " + ctx.role : ""}, ${dd.lift_s >= 0 ? "+" : ""}${String(dd.lift_s).replace(".", DS())} pts de win rate acima do esperado.`, `Game data: in ${dd.pick}% of Master+ player builds for this god${ctx.fontePrior === "deus-role" ? " in " + ctx.role : ""}, ${dd.lift_s >= 0 ? "+" : ""}${String(dd.lift_s)} pts win rate above expected.`));
      else if (ctx.fontePrior !== "deus") r.push(L("Dados de jogo: item comum e com bom desempenho nos outros deuses deste role.", "Game data: a common item that performs well on the other gods in this role."));
    }
    if (it.ativo) r.push(L("Item ativo (conta para o limite de 3).", "Active item (counts towards the limit of 3)."));
    if (!r.length) r.push(L("Melhor equilíbrio restante entre dano e resistência para este role.", "Best remaining balance between damage and durability for this role."));
    return r;
  };

  /* Relíquias: as mesmas contas, com os efeitos da relíquia somados à build */
  Engine.prototype.relics = function (opt, ctx, build) {
    const base = this.score(build.itens, build.caminho, ctx).val;
    const c = RELICS.map(id => this.items[id]).filter(Boolean).map(rel => {
      const v = this.score(build.itens.concat(Object.assign({}, rel, { stats: {} })), build.caminho, ctx).val - base;
      return { rel, v };
    });
    const why = L({ purification_beads: "Bloqueia o CC duro inimigo (", aegis_of_acceleration: "Imunidade a dano no burst inimigo.", phantom_shell: "Escudo e menos dano de ataques básicos.",
      sundering_arc: "Dano verdadeiro e anti-heal sem gastar ranhura.", agility_relic: "Mais tempo a atacar.", blink_rune: "Iniciação; o valor de posicionamento não entra nas contas." },
      { purification_beads: "Blocks enemy hard CC (", aegis_of_acceleration: "Damage immunity through enemy burst.", phantom_shell: "Shield and less basic attack damage.",
      sundering_arc: "True damage and anti-heal without using an item slot.", agility_relic: "More time attacking.", blink_rune: "Initiation; positioning value is not counted." });
    if (opt.role === "Jungle") { const s = c.find(x => x.rel.id === "sundering_arc"); if (s) s.v += 1; } // dano a dobrar em monstros da jungle (tooltip)
    return c.sort((x, y) => y.v - x.v).slice(0, 2).map(x => ({ item: x.rel, ganho: x.v,
      razao: x.rel.id === "purification_beads" ? why[x.rel.id] + `${ctx.ccIn.toFixed(1)}s` + L(" esperados por luta).", " expected per fight).") : (x.rel.id === "sundering_arc" && opt.role === "Jungle" ? L("Na jungle o dano dobra contra monstros; anti-heal cedo.", "In the jungle its damage doubles against monsters; early anti-heal.") : why[x.rel.id]) }));
  };

  Engine.prototype.finish = function (b, opt, ctx, topVal) {
    const tot = ctx.kit.str + ctx.kit.int, sh = tot ? ctx.kit.str / tot : 0.5;
    b.relativo = Math.round((b.score.val / topVal) * 100);
    b.experimental = (b.caminho === "inteligencia" && sh >= 0.8) || (b.caminho === "forca" && sh <= 0.2) || (b.caminho === "ataque" && sh <= 0.2);
    const lowConf = b.itens.filter(i => i.confianca !== "alta").length;
    b.confianca = ctx.kit.ab.length < 2 ? "baixa" : (lowConf >= 3 || !ctx.g.ad20 || ctx.kit.baDefault ? "média" : "alta");
    b.reliquias = this.relics(opt, ctx, b);
    b.ordem = b.itens.slice(); // ordem de compra = ordem em que a simulação os escolheu (o que mais rende primeiro)
    const by = {}; b.itens.forEach(i => by[i.id] = 1);
    const head = b.itens.slice(0, b.itens.length - 1);
    b.alternativas = b.dados ? [] : this.data.itens.filter(i => i.tier === "tier3" && !by[i.id] && allowed(i, b.caminho, ctx.g) && !(i.unico && head.some(c => c.unico === i.unico)))
      .map(i => ({ i, v: this.score(head.concat(i), b.caminho, ctx).val })).sort((a, c) => c.v - a.v).slice(0, 3).map(x => x.i);
    return b;
  };

  /* ---------- Build "base + ajuste" ----------
     Base: o que funciona para este deus neste role nos dados de jogo (frequência E vitórias), ou de deuses do mesmo tipo
     no mesmo role quando há poucos jogos. Ajuste: 2–3 ranhuras escolhidas pela simulação contra as equipas, só entre itens
     que se jogam nesse role e os counters claros. Assim a simulação não vai buscar itens onde o modelo se engana. */
  const COUNTER_FX = ["anti_heal", "anti_escudo", "anti_crit", "cc_block", "imune_slow", "anti_desloc", "imune"];
  Engine.prototype.dataSource = function (opt) {
    const CM = this.data.comunidade; if (!CM) return null;
    const own = CM.deuses[opt.god], R = own && own.por_role && own.por_role[opt.role];
    // com aspeto / sem aspeto: as builds dessa versão, se houver jogos suficientes
    const VA = own && own.por_aspeto && own.por_aspeto[opt.role] && own.por_aspeto[opt.role][opt.aspeto ? "aspeto" : "base"];
    if (VA && VA.jogos >= 20) return { src: VA, jogos: VA.jogos, fonte: "deus", variante: opt.aspeto ? "aspeto" : "base",
      txt: L(`${VA.jogos} jogos deste deus neste role, ${opt.aspeto ? "com aspeto" : "sem aspeto"}`, `${VA.jogos} games of this god in this role, ${opt.aspeto ? "with aspect" : "without aspect"}`) };
    if (R && R.jogos >= 20) return { src: R, jogos: R.jogos, fonte: "deus", txt: L(`${R.jogos} jogos deste deus neste role`, `${R.jogos} games of this god in this role`) };
    if (own && own.role === opt.role && own.jogos >= 20 && !R) return { src: own, jogos: own.jogos, fonte: "deus", txt: L(`${own.jogos} jogos deste deus (role principal)`, `${own.jogos} games of this god (main role)`) };
    // deuses do mesmo tipo de dano no mesmo role, mais os poucos jogos do próprio deus
    const meu = this.godKit(this.gods[opt.god], opt.aspeto).tipo;
    const acc = {}, st = {}; let J = 0;
    const add = (src, w) => { if (!src) return; J += src.jogos * w;
      Object.entries(src.itens).forEach(([id, d]) => { const a = acc[id] = acc[id] || { w: 0, pick: 0, lift: 0, slot: 0 }; a.w += w * src.jogos; a.pick += w * src.jogos * d.pick; a.lift += w * src.jogos * d.lift_s; a.slot += w * src.jogos * (d.slot || 3.5); });
      src.starters.forEach(x => { if (!x.id) return; const a = st[x.id] = st[x.id] || { w: 0, pick: 0, lift: 0 }; a.w += w * src.jogos; a.pick += w * src.jogos * x.pick; a.lift += w * src.jogos * x.lift_s; }); };
    Object.entries(CM.deuses).forEach(([gid, c]) => { const g = this.gods[gid]; if (!g || gid === opt.god) return;
      const src = c.por_role && c.por_role[opt.role] && c.por_role[opt.role].jogos >= 20 ? c.por_role[opt.role] : (c.role === opt.role ? c : null);
      if (src && this.godKit(g, false).tipo === meu) add(src, 1); });
    if (R) add(R, 3);
    if (!J) return null;
    const itens = {}; Object.entries(acc).forEach(([id, a]) => itens[id] = { pick: a.pick / J, lift_s: a.lift / J, slot: a.slot / a.w });
    const starters = Object.entries(st).map(([id, a]) => ({ id, pick: a.pick / J, lift_s: a.lift / J }));
    return { src: { itens, starters, jogos: Math.round(J) }, jogos: Math.round(J), fonte: "pares", txt: L(`deuses ${meu === "magico" ? "mágicos" : "físicos"} no ${opt.role}${R ? ` + ${R.jogos} jogos deste deus` : ""}`, `${meu === "magico" ? "magical" : "physical"} gods in ${opt.role}${R ? ` + ${R.jogos} games of this god` : ""}`) };
  };
  Engine.prototype.rolePool = function (role) {
    this._rp = this._rp || {}; if (this._rp[role]) return this._rp[role];
    const CM = this.data.comunidade, tot = {}; let J = 0;
    Object.values(CM.deuses).forEach(c => { const src = c.por_role && c.por_role[role] ? c.por_role[role] : (c.role === role ? c : null); if (!src) return; J += src.jogos;
      Object.entries(src.itens).forEach(([id, d]) => tot[id] = (tot[id] || 0) + src.jogos * d.pick / 100); });
    const set = new Set(Object.entries(tot).filter(([, n]) => n / J >= 0.01).map(([id]) => id));
    return this._rp[role] = set;
  };
  /* nota dos dados: a frequência manda (pick/10), a win rate só desempata (±3), para itens raros com amostra pequena não passarem à frente */
  /* situacionais: mínimo de presença nas builds do deus e peso da frequência (pontos de % de ganho por cada 1% de builds, até 60%) */
  const SIT_MIN = +(globalThis.__SM || 3), SIT_W = +(globalThis.__SW || 0.045);
  const rData = d => d.pick / 10 + Math.max(-3, Math.min(3, d.lift_s));
  Engine.prototype.buildBase = function (opt, ctx, ds) {
    const g = ctx.g, S = ds.src;
    // caminho: o que os itens jogados neste role mostram (mais presença nos dados), dentro do que o kit permite
    const paths = this.paths(ctx.kit);
    // presença só dos itens que distinguem cada caminho (Força sem velocidade/crítico; ataque = velocidade/crítico; Int; adaptativo)
    const kind = it => { const t = it.stats || {}; if (t.adapt_int || t.adapt_str) return "hibrido"; if (t.int) return "inteligencia"; if (t.as_pct || t.crit_pct) return "ataque"; if (t.str || t.ad) return "forca"; return null; };
    const pr = {}; Object.entries(S.itens).forEach(([id, d]) => { const it = this.items[id]; if (!it || it.tier !== "tier3") return; const k = kind(it); if (k) pr[k] = (pr[k] || 0) + d.pick; });
    const pres = p => p === "ataque" ? (pr.ataque || 0) * 2 + (pr.forca || 0) * 0.5 : p === "forca" ? (pr.forca || 0) + (pr.ataque || 0) * 0.25 : (pr[p] || 0);
    const path = paths.slice().sort((a, b) => pres(b) - pres(a))[0];
    const base = this.evaluate([], path, ctx), ctxS = Object.assign({}, ctx, { bonusByPath: null });
    const ok = (set, it) => !set.includes(it) && !(it.ativo && set.filter(c => c.ativo).length >= 3) && !(it.unico && set.some(c => c.unico === it.unico));
    // starter: o que mais rende nos dados (frequência + vitórias)
    const stc = (S.starters || []).map(x => ({ x, it: this.items[x.id] })).filter(o => o.it).map(o => ({ ...o, up: o.it.tier === "starter_upgrade" ? o.it : this.items[UPG[o.it.id]] }))
      .filter(o => o.up && allowed(o.up, path, g) && ((STARTERS[opt.role] || []).some(s => UPG[s] === o.up.id || s === o.it.id) || o.x.pick >= 15));
    stc.sort((a, b) => rData(b.x) - rData(a.x));
    // sem starter válido nos dados: o starter do role que mais rende na simulação (primeiro os do caminho, depois qualquer um do role)
    let starter = stc.length ? stc[0].up : null, stSim = false;
    if (!starter) {
      const ups = (STARTERS[opt.role] || []).map(sid => this.items[UPG[sid]]).filter(Boolean);
      const cands = ups.filter(u => allowed(u, path, g)).length ? ups.filter(u => allowed(u, path, g)) : ups;
      let bst = null; cands.forEach(u => { const v = this.score([u], path, ctx, this.evaluate([], path, ctx)).val; if (!bst || v > bst.v) bst = { u, v }; });
      if (bst) { starter = bst.u; stSim = true; }
    }
    // base
    const nCore = 3; // 3 itens core (dados) + 3 situacionais (simulação contra as equipas)
    const GI = {}; this.godItems(opt).forEach(x => { GI[x.id] = x; });
    const cand = Object.entries(S.itens).map(([id, d]) => ({ it: this.items[id] || GI[id], d })).filter(o => o.it && (o.it.tier === "tier3" ? allowed(o.it, path, g) : o.it.tier === "deus") && o.d.pick >= 8)
      .sort((a, b) => rData(b.d) - rData(a.d));
    const core = [];
    for (const o of cand) { if (core.length >= nCore) break; if (ok(core.map(c => c.it), o.it)) core.push(o); }
    // ajuste: simulação contra as equipas, só entre itens jogados no role, counters e itens do deus
    const RP = this.rolePool(opt.role);
    // itens de ataque básico (velocidade/crítico) só entram num caminho de Força se os jogadores deste deus os usam
    const own = S.itens;
    // situacionais: só entre os itens que os jogadores compram com este deus neste role (e aspeto) — ≥3% das builds,
    // ou ≥1% se for um counter (anti-cura, anti-escudo, anti-crítico, proteção contra CC); a simulação escolhe o que serve à partida
    const pk = id => (own[id] || {}).pick || 0;
    const isCounter = i => (i.efeitos || []).some(f => COUNTER_FX.includes(f.t));
    let pool = this.data.itens.filter(i => i.tier === "tier3" && (pk(i.id) >= SIT_MIN || (isCounter(i) && pk(i.id) >= 1)) && (allowed(i, path, g) || pk(i.id) >= 10))
      .concat(this.godItems(opt).filter(i => pk(i.id) >= 1));
    // poucos itens nos dados: junta os itens jogados no role, como antes
    if (pool.length < 8) pool = pool.concat(this.data.itens.filter(i => i.tier === "tier3" && !pool.includes(i) && allowed(i, path, g) && (RP.has(i.id) || isCounter(i))
      && !(path === "forca" && kind(i) === "ataque" && !(pk(i.id) >= 5))));
    const fixed = (starter ? [starter] : []).concat(core.map(c => c.it));
    const flex = [];
    const sc = arr => this.score(arr, path, ctxS, base);
    // nota de cada candidato: ganho na simulação contra estas equipas (%) + peso da frequência nas builds dos jogadores
    const selv = (set, it, ref) => (sc(set.concat(it)).val / ref - 1) * 100 + SIT_W * Math.min(pk(it.id), 60);
    while (fixed.length + flex.length < (starter ? 7 : 6)) {
      const set = fixed.concat(flex), ref = sc(set).val; let top = null;
      for (const it of pool) { if (!ok(set, it)) continue; const v = selv(set, it, ref); if (!top || v > top.v) top = { it, v }; }
      if (!top) break; flex.push(top.it);
    }
    // revisão: cada ranhura de ajuste pode trocar; a base pode ceder um lugar a um counter se a simulação ganhar ≥4%
    for (let k = 0; k < flex.length; k++) { const rest = fixed.concat(flex.filter((_, j) => j !== k)), ref = sc(rest).val;
      let bi = flex[k], bv = selv(rest, flex[k], ref) + 1e-4;
      for (const it of pool) { if (!ok(rest, it)) continue; const v = selv(rest, it, ref); if (v > bv) { bv = v; bi = it; } } flex[k] = bi; }
    let curV = sc(fixed.concat(flex)).val;
    const trocas = [];
    const SWAP_FX = ["anti_heal", "anti_escudo", "anti_crit", "cc_block"];
    // 3 core + 3 situacionais sempre: os counters entram pelos lugares situacionais, o core não cede lugar
    if (false) core.forEach((c, k) => { const rest = fixed.filter(x => x !== c.it).concat(flex); let bi = null, bv = curV * 1.06;
      for (const it of pool) { if (!ok(rest, it) || !(it.efeitos || []).some(f => SWAP_FX.includes(f.t))) continue; const v = sc(rest.concat(it)).val; if (v > bv) { bv = v; bi = it; } }
      if (bi) { trocas.push({ sai: c.it, entra: bi, ganho: Math.round((bv / curV - 1) * 100) }); fixed[fixed.indexOf(c.it)] = bi; c.trocado = bi; curV = bv; } });
    // ordem: starter; base pela ranhura típica; ajuste pelo que mais rende
    const coreItems = core.filter(c => !c.trocado).sort((a, b) => (a.d.slot || 3.5) - (b.d.slot || 3.5)).map(c => c.it);
    const adj = flex.concat(trocas.map(t => t.entra));
    const ord = (starter ? [starter] : []).concat(coreItems);
    const why = {};
    if (starter && stSim) why[starter.id] = [L(`Starter de ${opt.role}: os dados deste deus não têm um starter deste role para este caminho; escolhido pela simulação.`, `${opt.role} starter: the data for this god has no starter for this role on this path; chosen by the simulation.`)];
    else if (starter) { const x = stc[0].x; why[starter.id] = [L(`Core: o starter de ${Math.round(x.pick)}% das builds (${ds.txt})${Math.abs(x.lift_s) >= 1 ? `, ${x.lift_s > 0 ? "+" : ""}${x.lift_s.toFixed(1).replace(".", DS())} pts de vitória face à média` : ""}.`, `Core: the starter in ${Math.round(x.pick)}% of builds (${ds.txt})${Math.abs(x.lift_s) >= 1 ? `, ${x.lift_s > 0 ? "+" : ""}${x.lift_s.toFixed(1)} pts win rate vs average` : ""}.`)]; }
    core.filter(c => !c.trocado).forEach(c => why[c.it.id] = [L(`Core: em ${Math.round(c.d.pick)}% das builds (${ds.txt}), normalmente por volta da ${Math.round(c.d.slot || 3)}.ª compra${Math.abs(c.d.lift_s) >= 1 ? `; quem o faz ganha ${c.d.lift_s > 0 ? "+" : ""}${c.d.lift_s.toFixed(1).replace(".", DS())} pts face à média` : ""}.`, `Core: in ${Math.round(c.d.pick)}% of builds (${ds.txt}), usually around purchase #${Math.round(c.d.slot || 3)}${Math.abs(c.d.lift_s) >= 1 ? `; players who build it win ${c.d.lift_s > 0 ? "+" : ""}${c.d.lift_s.toFixed(1)} pts vs average` : ""}.`)]);
    const rem = adj.slice();
    while (rem.length) { const cur = sc(ord); let top = null; rem.forEach(it => { const v = sc(ord.concat(it)); const dlt = v.val - cur.val; if (!top || dlt > top.d) top = { it, d: dlt, sc: v, cur }; });
      ord.push(top.it); rem.splice(rem.indexOf(top.it), 1);
      const t = trocas.find(x => x.entra === top.it);
      why[top.it.id] = [(t ? L(`Situacional: entra no lugar de ${t.sai.nome} (+${t.ganho}% na simulação contra estas equipas). `, `Situational: replaces ${t.sai.nome} (+${t.ganho}% in the simulation against these teams). `) : (pk(top.it.id) >= 1 ? L(`Situacional: comprado em ${Math.round(pk(top.it.id))}% das builds (${ds.txt}); escolhido para esta partida pela simulação contra estas equipas. `, `Situational: bought in ${Math.round(pk(top.it.id))}% of builds (${ds.txt}); picked for this match by the simulation against these teams. `) : L("Situacional: escolhido pela simulação contra estas equipas, entre os itens que se jogam neste role. ", "Situational: chosen by the simulation against these teams, among the items played in this role. "))) + this.explain(top, ctx).join(" ")]; }
    const final = this.score(ord, path, ctx, base);
    return { caminho: path, rotulo: PL(path), itens: ord, porque: why, score: final, base: true, fonteBase: ds.txt, nBase: coreItems.length + (starter ? 1 : 0), ajuste: adj.map(i => i.id), trocasBase: trocas.map(t => ({ sai: t.sai.nome, entra: t.entra.nome, ganho: t.ganho })) };
  };


  /* ---------- Build dos jogadores (SmiteBrain, build a build) ----------
     Cada build lida tem: itens por ordem de compra, starter, relíquia, vitória/derrota e os 5 inimigos.
     Para o deus, role e aspeto escolhidos, cada build pesa conforme a equipa contra quem foi jogada se parece com a escolhida:
       peso = (1 + inimigos iguais)^1,5 × semelhança da composição² (tipo de dano e role principal de cada inimigo).
     A build mostrada é a mais usada ranhura a ranhura: na ranhura k, o item mais comprado nessa posição pelas builds que
     começaram como esta (mesma ordem); se forem poucas, pelas que têm os mesmos itens; se ainda forem poucas, por todas. */
  Engine.prototype.setBuilds = function (J) { this.BJ = J; this._bc = {}; this.BJ.idx = {}; };
  const B36 = s => parseInt(s, 36);
  const OBJ_EXP = +(globalThis.__OE || 2);
  Engine.prototype.jogos = function (god, role, v) {
    const J = this.BJ; if (!J) return [];
    const k = god + "|" + role + "|" + v; if (this._bc[k]) return this._bc[k];
    const raw = J.B[k]; const out = [];
    if (raw) raw.split(";").forEach(t => { const [vv, st, rel, its, en, d] = t.split(",");
      out.push({ v: +vv, s: st ? J.I[B36(st)] : null, r: rel ? J.I[B36(rel)] : null, it: its ? its.split(".").map(x => J.I[B36(x)]) : [], en: en ? en.split(".").map(x => J.G[B36(x)]) : [], d }); });
    return (this._bc[k] = out);
  };
  Engine.prototype.itemJ = function (id) {
    if (!id) return null; if (this.items[id]) return this.items[id];
    this._gi = this._gi || {}; if (this._gi[id]) return this._gi[id];
    const gi = (this.data.itens_deus || []).find(x => x.id === id);
    const nome = gi ? gi.nome : String(id).replace(/^x:/, "");
    return (this._gi[id] = { id, nome, tier: "deus", custo: gi ? gi.custo : null, stats: {}, efeitos: [], exclusivo: true, confianca: "alta" });
  };
  Engine.prototype.buildJogos = function (opt, ctx) {
    if (!this.BJ) return null;
    const va = opt.aspeto ? "aspeto" : "base", vo = opt.aspeto ? "base" : "aspeto";
    let A = this.jogos(opt.god, opt.role, va).map(b => Object.assign({ w0: 1 }, b)), mistura = false;
    if (A.length < 25) { const O = this.jogos(opt.god, opt.role, vo); if (O.length) { A = A.concat(O.map(b => Object.assign({ w0: 0.4 }, b))); mistura = O.length > 0; } }
    if (A.length < 8) return null;
    const nAsp = this.jogos(opt.god, opt.role, va).length;
    const E = (opt.inimigos || []).map(x => typeof x === "string" ? x : x.id).filter(id => this.gods[id]);
    const RL = ["Solo", "Jungle", "Mid", "Support", "Carry"];
    const vec = ids => { const v = [0, 0, 0, 0, 0, 0]; ids.forEach(id => { const g = this.gods[id]; if (!g) return; if (g.tipo_dano === "magico") v[0]++; const r = RL.indexOf(this.mainRole(id)); if (r >= 0) v[1 + r]++; });
      const n = ids.length || 1; return v.map(x => x / n); };
    const vE = vec(E);
    const defShare = b => { let d = 0, n = 0; b.it.forEach(id => { const it = this.items[id]; if (!it) return; n++; const st = it.stats || {};
      const off = st.str || st.int || st.ad || st.as_pct || st.crit_pct || st.adapt_int || st.adapt_str; const def = st.hp || st.pp || st.mp || st.prot; if (def && !off) d++; }); return n ? d / n : 0; };
    const obj = opt.objetivo || "otimizado";
    let iguais2 = 0, iguais1 = 0;
    A.forEach(b => { let w = b.w0;
      if (E.length) { const ov = b.en.filter(e => E.includes(e)).length; const vb = vec(b.en); const dist = vb.reduce((a, x, i) => a + Math.abs(x - vE[i]), 0);
        w *= Math.pow(1 + ov, 1.5) * Math.pow(1 / (1 + dist), 2); if (ov >= 2) iguais2++; if (ov >= 1) iguais1++; b.ov = ov; }
      // objetivo: Dano favorece as builds com menos itens defensivos, Resistência as que têm mais (sem mexer no resto)
      if (obj === "dano") w *= Math.pow(1.05 - defShare(b), OBJ_EXP); else if (obj === "resistencia") w *= Math.pow(0.1 + defShare(b), OBJ_EXP);
      b.w = w; });
    const eff = C => { let s = 0, q = 0; C.forEach(b => { s += b.w; q += b.w * b.w; }); return q ? s * s / q : 0; };
    const ok = (set, id) => { const it = this.itemJ(id); if (!it || set.includes(id)) return false;
      if (it.unico && set.some(x => (this.itemJ(x) || {}).unico === it.unico)) return false;
      if (it.ativo && set.filter(x => (this.itemJ(x) || {}).ativo).length >= 3) return false; return true; };
    const moda = (C, get, excl) => { const m = {}; C.forEach(b => { const x = get(b); if (!x || (excl && excl(x))) return; const a = m[x] = m[x] || { w: 0, wv: 0, n: 0 }; a.w += b.w; a.wv += b.w * b.v; a.n++; });
      const tot = C.reduce((a, b) => a + b.w, 0); return Object.entries(m).map(([id, a]) => ({ id, pick: a.w / tot * 100, win: a.wv / a.w * 100, n: a.n })).sort((x, y) => y.pick - x.pick); };
    const chosen = [], info = {};
    for (let k = 0; k < 6; k++) {
      // segue a ordem exata enquanto houver jogos que a sustentem (≥15 builds e amostra efetiva ≥8); senão alarga
      const chega = C => C.length >= 15 && eff(C) >= 8;
      let C = A.filter(b => b.it.length > k && chosen.every((c, j) => b.it[j] === c)), nivel = "ordem";
      if (!chega(C)) { C = A.filter(b => b.it.length > k && chosen.every(c => b.it.includes(c))); nivel = "itens"; }
      if (!chega(C)) { C = A.filter(b => b.it.length > k); nivel = "todas"; }
      let top = moda(C, b => b.it[k], id => !ok(chosen, id))[0];
      if (top && top.n < 3 && nivel !== "todas") { C = A.filter(b => b.it.length > k); nivel = "todas"; top = moda(C, b => b.it[k], id => !ok(chosen, id))[0]; }
      if (!top) { const T = moda(A, b => b.it.find(id => ok(chosen, id)), null)[0]; if (!T) break; top = T; nivel = "todas"; }
      chosen.push(top.id); info[top.id] = { k: k + 1, pick: top.pick, win: top.win, n: top.n, nivel, alt: moda(C, b => b.it[k], id => !ok(chosen, id)).slice(0, 2) };
    }
    if (chosen.length < 3) return null;
    const stT = moda(A, b => b.s)[0], relT = moda(A, b => b.r);
    const starter = stT ? this.itemJ(stT.id) : null;
    const itens = (starter ? [starter] : []).concat(chosen.map(id => this.itemJ(id)));
    // caminho (para as contas de dano e o resto da página): o que melhor serve estes itens
    let best = null; this.paths(ctx.kit).forEach(p => { const v = this.score(itens, p, ctx).val; if (!best || v > best.v) best = { p, v }; });
    const path = best ? best.p : "forca";
    const pc = x => Math.round(x); const fmt = x => pc(x) + "%";
    const why = {};
    if (starter) why[starter.id] = [L(`Starter de ${fmt(stT.pick)} destas builds (${fmt(stT.win)} de vitórias).`, `Starter in ${fmt(stT.pick)} of these builds (${fmt(stT.win)} wins).`)];
    const NIV = { ordem: L("das builds que começaram assim", "of builds that started this way"), itens: L("das builds com os mesmos itens", "of builds with the same items"), todas: L("de todas as builds", "of all builds") };
    chosen.forEach(id => { const x = info[id];
      why[id] = [L(`${x.k}.º item em ${fmt(x.pick)} ${NIV[x.nivel]} (${x.n} jogos, ${fmt(x.win)} de vitórias).`, `Item #${x.k} in ${fmt(x.pick)} ${NIV[x.nivel]} (${x.n} games, ${fmt(x.win)} wins).`)
        + (x.alt.length ? L(" Alternativa: ", " Alternative: ") + x.alt.map(a => (this.itemJ(a.id) || {}).nome + " " + fmt(a.pick)).join(", ") + "." : "")]; });
    // jogos com exatamente esta ordem nos 3 primeiros itens
    const tres = A.filter(b => chosen.slice(0, 3).every((c, j) => b.it[j] === c));
    const winT = tres.length ? tres.reduce((a, b) => a + b.v, 0) / tres.length * 100 : null;
    const reliquias = relT.slice(0, 2).map(r => ({ item: this.itemJ(r.id), razao: L(`em ${fmt(r.pick)} destas builds (${fmt(r.win)} de vitórias).`, `in ${fmt(r.pick)} of these builds (${fmt(r.win)} wins).`) }));
    const alternativas = moda(A, b => b.it.find(id => !chosen.includes(id) && this.items[id] && this.items[id].tier === "tier3"), null).slice(0, 3).map(x => this.items[x.id]).filter(Boolean);
    const ASP = this.BJ.L && this.BJ.L[opt.god + "|" + opt.role];
    const fonte = L(`${nAsp} builds Master+ deste deus no ${opt.role} ${opt.aspeto ? "com aspeto" : "sem aspeto"}, de ${this.BJ.corte} a ${this.BJ.lido_em}`, `${nAsp} Master+ builds of this god in ${opt.role} ${opt.aspeto ? "with aspect" : "without aspect"}, ${this.BJ.corte} to ${this.BJ.lido_em}`)
      + (mistura ? L(`, mais ${A.length - nAsp} da outra versão (poucos jogos nesta)`, `, plus ${A.length - nAsp} from the other version (few games in this one)`) : "");
    const contra = E.length ? L(`Contra a equipa escolhida: ${iguais1} jogos com pelo menos um dos mesmos inimigos e ${iguais2} com dois ou mais; as builds contra equipas parecidas contam mais.`,
      `Against the chosen team: ${iguais1} games with at least one of the same enemies and ${iguais2} with two or more; builds against similar teams count more.`) : L("Sem equipa adversária escolhida: todas as builds contam o mesmo.", "No enemy team chosen: every build counts the same.");
    const sc = this.score(itens, path, ctx);
    return { caminho: path, rotulo: PL(path), itens, porque: why, score: sc, dados: true, fonteBase: fonte, contra, jogos: A.length,
      tres: tres.length, winTres: winT, reliquiasDados: reliquias, alternativasDados: alternativas, aspetos: ASP || null, ajuste: [], base: false, trocasBase: [] };
  };

  Engine.prototype.recommend = function (opt) {
    const g = this.gods[opt.god];
    if (!g) throw new Error(L("Deus desconhecido", "Unknown god"));
    const ctx = this.ctx(opt);
    const seen = new Set();
    /* Caminho (Força, Inteligência, ataque, híbrido): se há dados do próprio deus, conta a nota com dados (os jogadores
       desse deus mostram o caminho); se só há a média de outros deuses do role, conta só a simulação do kit, para os dados
       de outros deuses não empurrarem um mago para uma build física (ou o contrário). */
    const ctxSim = Object.assign({}, ctx, { bonusByPath: null });
    const bj0 = opt.livre ? null : this.buildJogos(opt, ctx);
    const builds = bj0 ? [] : this.paths(ctx.kit).map(p => { const b = this.build(opt, p, ctx); b.simVal = this.score(b.itens, p, ctxSim).val; return b; })
      .sort((a, b) => b.simVal - a.simVal)
      .filter(b => { const k = b.itens.map(i => i.id).sort().join(); if (seen.has(k)) return false; seen.add(k); return true; });
    builds.forEach(b => this.finish(b, opt, ctx, builds[0].score.val));
    builds.forEach(b => b.relativo = Math.round(b.simVal / builds[0].simVal * 100));
    const normal = builds.filter(b => !b.experimental);
    if (builds.length && builds[0].experimental && normal.length && normal[0].relativo >= 85) { builds.splice(builds.indexOf(normal[0]), 1); builds.unshift(normal[0]); }
    const ds = opt.livre || bj0 ? null : this.dataSource(opt);
    const bj = bj0;
    if (bj) {
      bj.simVal = this.score(bj.itens, bj.caminho, ctxSim).val; this.finish(bj, opt, ctx, bj.score.val);
      bj.reliquias = bj.reliquiasDados.length ? bj.reliquiasDados : bj.reliquias; if (bj.alternativasDados.length) bj.alternativas = bj.alternativasDados;
      bj.relativo = 100; bj.confianca = bj.jogos >= 80 ? "alta" : bj.jogos >= 25 ? "média" : "baixa"; bj.experimental = false;
      builds.length = 0; builds.push(bj);
    } else if (ds) {
      const bb = this.buildBase(opt, ctx, ds); bb.simVal = this.score(bb.itens, bb.caminho, ctxSim).val;
      this.finish(bb, opt, ctx, bb.score.val); bb.relativo = Math.round(bb.simVal / builds[0].simVal * 100);
      builds.forEach(b => b.livre = true);
      builds.unshift(bb);
    }
    builds[0].principal = true;
    const P = builds[0], gi = this.godItems(opt).filter(x => !P.itens.some(i => i.id === x.id));
    if (gi.length && !P.dados) {
      const full = this.score(P.itens, P.caminho, ctx).val;
      const weakest = P.itens.slice(1).map(i => ({ i, v: full - this.score(P.itens.filter(x => x !== i), P.caminho, ctx).val })).sort((a, b) => a.v - b.v)[0];
      P.exclusivos = gi.map(x => {
        const v = this.score(P.itens.filter(i => i !== weakest.i).concat(x), P.caminho, ctx).val;
        return { item: x, troca: weakest.i, rel: Math.round(v / full * 100) };
      });
    }
    const cruz = builds[0].dados ? null : this.cruzamento(opt, ctx, builds);
    const tot = ctx.kit.str + ctx.kit.int;
    const consumiveis = [];
    const team = [opt.god].concat((opt.aliados || []).map(x => typeof x === "string" ? x : x.id));
    if (opt.god === "hua_mulan") consumiveis.push({ nome: "Training Grounds", razao: L("Exclusivo da Hua Mulan, ocupa uma ranhura de consumível: estandarte de 45s; dentro de 11m o Training Arc fica sempre ativo e os aliados ganham velocidade (10% segundo as notas OB18; a wiki diz 5%). Cooldown 90s (OB18).", "Hua Mulan exclusive, takes a consumable slot: 45s banner; within 11m Training Arc is always active and allies gain movement speed (10% per the OB18 notes; the wiki says 5%). 90s cooldown (OB18).") });
    if (opt.god === "aladdin") consumiveis.push({ nome: "Genie's Lamp", razao: L("Começa no inventário e ocupa uma ranhura de consumível: +0,6% por nível dos stats de itens (12% ao nível 20, OB24) e acesso aos 3 desejos. Já está incluída nas contas da build.", "Starts in your inventory and takes a consumable slot: +0.6% item stats per level (12% at level 20, OB24) and access to the 3 wishes. Already included in the build maths.") });
    if (opt.god === "vulcan") consumiveis.push({ nome: L("Nota sobre mods", "Note on mods"), razao: L("Se escolher o Dual Mod, o Thumper ocupa a primeira ranhura de consumível durante o jogo todo (OB2).", "If you pick the Dual Mod, the Thumper takes the first consumable slot for the whole game (OB2).") });
    if (team.includes("baron_samedi")) consumiveis.push({ nome: "Baron's Brew", razao: L("Há um Baron Samedi na equipa: substitui as poções (+18 vida/s e +18 mana/s durante 14s, recarrega na base) e a garrafa vazia aplica Hysteria para o Baron. Valores da wiki, por confirmar no cliente.", "There is a Baron Samedi on your team: it replaces potions (+18 health/s and +18 mana/s for 14s, refills at base) and the empty bottle applies Hysteria for Baron. Wiki values, not yet confirmed in the client.") });
    else consumiveis.push({ nome: g.usa_mana ? "Multi Potion / Health Potion" : "Health Potion", razao: g.usa_mana ? L("Sustain no início da lane.", "Early lane sustain.") : L("Não usa mana: só poções de vida.", "No mana: health potions only.") });
    return { deus: g, ctx, consumiveis, kit: { str: tot ? Math.round(ctx.kit.str / tot * 100) : 0, int: tot ? Math.round(ctx.kit.int / tot * 100) : 0, n: ctx.kit.ab.length, ba: ctx.kit.ba, passiva: ctx.kit.passiva, cc: ctx.kit.cc },
      perfil: ctx.perfil, builds, cruzamento: cruz, pressupostos: L(PRESSUPOSTOS, PRESSUPOSTOS_EN), modo: opt.modo, identidade: L(ROLE_ID_PT, ROLE_ID_EN)[opt.role] };
  };

  /* Cruzamento com dados de jogo de terceiros (SmiteBrain): sinal secundário, nunca verdade.
     1) anota a build do motor com a frequência e o desempenho de cada item;
     2) para os itens muito usados que o motor não pôs, mede quanto a build perde com eles e porquê;
     3) refaz a build com um pequeno bónus para itens que ganham acima do esperado (lift corrigido do viés de ranhura). */
  /* Sinal de dados de jogo para este deus e role: os dados do próprio deus quando existem para esse role;
     senão a média dos outros deuses do mesmo role (com mais peso para os do mesmo tipo de dano).
     bónus por item = desempenho (lift corrigido e encolhido) + USO_DADOS × frequência/10. */
  Engine.prototype.prior = function (opt) {
    const CM = this.data.comunidade; if (!CM || !LAMBDA_DADOS) return null;
    const own = CM.deuses[opt.god];
    const CAP = +(globalThis.__CAP ?? 0) || Infinity, cl = x => Math.max(-CAP, Math.min(CAP, x));
    const mk = (src) => { const b = {}; Object.entries(src.itens).forEach(([id, d]) => b[id] = cl(d.lift_s + USO_DADOS * d.pick / 10));
      src.starters.concat(src.reliquias).forEach(x => { if (x.id) b[x.id] = cl((b[x.id] || 0) + x.lift_s + USO_DADOS * x.pick / 10); }); return b; };
    // quanto das builds desse deus é Inteligência (0) a Força/ataque (1): o sinal só vale para builds do mesmo tipo
    const intShare = src => { let i = 0, f = 0; Object.entries(src.itens).forEach(([id, d]) => { const it = this.items[id]; if (!it) return; const st = it.stats;
      const I = !!(st.int || st.adapt_int), S = !!(st.str || st.ad || st.as_pct || st.crit_pct);
      if (I && !S) i += d.pick; else if (S && !I) f += d.pick; else if (I && S && !(st.adapt_int && st.adapt_str)) { i += d.pick / 2; f += d.pick / 2; } });
      return (i + f) ? i / (i + f) : 0.5; };
    const sim = (path, x) => path === "inteligencia" ? x : path === "hibrido" ? 1 - Math.abs(x - 0.5) : 1 - x;
    // dados por role (página ?role= do SmiteBrain) quando existem; senão o agregado do deus
    const roleOf = src => src.por_role && src.por_role[opt.role] ? src.por_role[opt.role] : null;
    const ownR = own && !globalThis.__LOO ? roleOf(own) : null;
    const confR = ownR ? Math.min(1, ownR.jogos / 80) : 0;
    const shareRole = own ? Math.max(own.role === opt.role ? 0.5 : 0, (own.roles || {})[opt.role] || 0) : 0;
    const sameRole = !!(own && shareRole >= 0.3 && !globalThis.__LOO); // o agregado do deus é deste role (amostras pequenas por role não o tornam)
    const useOwn = own && !globalThis.__LOO;
    const peers = Object.entries(CM.deuses).filter(([gid]) => gid !== opt.god && this.gods[gid])
      .map(([gid, src]) => [gid, roleOf(src) || (src.role === opt.role || ((src.roles || {})[opt.role] || 0) >= 0.5 ? src : null)]).filter(x => x[1]);
    const norm = peers.reduce((a, [, src]) => a + Math.sqrt(src.jogos), 0);
    const byPath = {};
    ["forca", "inteligencia", "ataque", "hibrido"].forEach(path => {
      const acc = {}; const addB = (b, w) => Object.entries(b).forEach(([id, v]) => acc[id] = (acc[id] || 0) + w * v);
      if (ownR) addB(mk(ownR), confR * Math.max(0.15, sim(path, intShare(ownR))));
      if (useOwn && confR < 1) addB(mk(own), (1 - confR) * (sameRole ? 1 : 0.25) * Math.max(0.15, sim(path, intShare(own))));
      if ((!sameRole || confR < 0.5) && norm) peers.forEach(([, src]) => addB(mk(src), Math.sqrt(src.jogos) / norm * PRIOR_ROLE * (sameRole ? 0.5 : 1) * Math.max(0.1, sim(path, intShare(src)))));
      byPath[path] = acc;
    });
    if (!useOwn && !norm) return null;
    return { byPath, fonte: ownR ? "deus-role" : sameRole ? "deus" : (useOwn ? "deus+role" : "role") };
  };

  Engine.prototype.cruzamento = function (opt, ctx, builds) {
    let C = this.data.comunidade && this.data.comunidade.deuses[opt.god];
    const CA = C && C.por_aspeto && C.por_aspeto[opt.role] && C.por_aspeto[opt.role][opt.aspeto ? "aspeto" : "base"];
    if (CA && CA.jogos >= 20) C = Object.assign({}, CA, { role: opt.role, porRole: true, variante: opt.aspeto ? "aspeto" : "base" });
    else if (C && C.por_role && C.por_role[opt.role]) C = Object.assign({}, C.por_role[opt.role], { role: opt.role, porRole: true });
    const P = builds[0];
    // a mesma simulação sem o sinal dos dados, para comparar
    let semDados = null;
    if (ctx.bonusByPath) {
      const ctxS = Object.assign({}, ctx, { bonusByPath: null });
      const cand = this.paths(ctx.kit).map(p => this.build(opt, p, ctxS)).sort((a, b) => b.score.val - a.score.val)[0];
      const vP = this.score(P.itens, P.caminho, ctxS).val;
      semDados = { itens: cand.itens, caminho: cand.caminho, rotulo: cand.rotulo, rel: Math.round(vP / cand.score.val * 100), iguais: cand.itens.filter(i => P.itens.includes(i)).length };
    }
    if (!C) return ctx.bonusByPath ? { soRole: true, semDados, role: opt.role, fonte: this.data.comunidade.fonte } : null;
    const mesmoRole = C.role === opt.role;
    const anot = P.itens.map(i => ({ item: i, dados: C.itens[i.id] || null, starter: (C.starters.find(s => s.id === i.id) || null) }));
    const full = this.score(P.itens, P.caminho, ctx);
    const contrib = P.itens.slice(1).map(i => ({ i, v: full.val - this.score(P.itens.filter(x => x !== i), P.caminho, ctx).val })).sort((a, b) => a.v - b.v);
    const weakest = contrib[0] && contrib[0].i;
    const faltam = Object.entries(C.itens).filter(([id, d]) => d.pick >= 15 && !P.itens.some(i => i.id === id) && this.items[id])
      .sort((a, b) => b[1].pick - a[1].pick).slice(0, 6).map(([id, d]) => {
        const it = this.items[id];
        // trocar pelo item da build cuja saída custa menos com este item lá dentro
        let best = null;
        P.itens.slice(1).forEach(out => { const set = P.itens.filter(x => x !== out).concat(it); const s = this.score(set, P.caminho, ctx); if (!best || s.val > best.s.val) best = { out, s }; });
        const a = full.ev, b = best.s.ev, dOff = (b.off / a.off - 1) * 100, dT = (Math.min(b.T, 30) / Math.min(a.T, 30) - 1) * 100;
        let porque;
        if (!allowed(it, P.caminho, ctx.g)) porque = L("não serve o caminho desta build (", "does not fit this build's path (") + PL(P.caminho) + ")";
        else if (dOff < -1 && dT < 1) porque = L(`com ele a build faz ${Math.abs(dOff).toFixed(0)}% menos progresso para matar sem ganhar sobrevivência`, `with it the build makes ${Math.abs(dOff).toFixed(0)}% less kill progress without gaining survival`);
        else if (dT < -1 && dOff < 1) porque = L(`com ele a build aguenta ${Math.abs(dT).toFixed(0)}% menos tempo contra esta equipa`, `with it the build survives ${Math.abs(dT).toFixed(0)}% less time against this team`);
        else if (dOff < 0 && dT > 0) porque = L(`troca ${Math.abs(dOff).toFixed(0)}% de dano por +${dT.toFixed(0)}% de sobrevivência, e o peso do role (${Math.round(ctx.wo * 100)}/${Math.round(ctx.wd * 100)}) prefere o dano`, `trades ${Math.abs(dOff).toFixed(0)}% damage for +${dT.toFixed(0)}% survival, and the role weight (${Math.round(ctx.wo * 100)}/${Math.round(ctx.wd * 100)}) prefers damage`);
        else if (dOff > 0 && dT < 0) porque = L(`troca ${Math.abs(dT).toFixed(0)}% de sobrevivência por +${dOff.toFixed(0)}% de dano, e o peso do role (${Math.round(ctx.wo * 100)}/${Math.round(ctx.wd * 100)}) prefere sobreviver`, `trades ${Math.abs(dT).toFixed(0)}% survival for +${dOff.toFixed(0)}% damage, and the role weight (${Math.round(ctx.wo * 100)}/${Math.round(ctx.wd * 100)}) prefers survival`);
        else porque = L("fica praticamente empatado com o item que sai", "is practically tied with the item it replaces");
        const notas = (it.efeitos || []).length ? "" : L(" O motor não tem nenhum efeito modelado para a passiva/ativo deste item: pode estar a subvalorizá-lo.", " The engine has no modelled effect for this item's passive/active: it may be undervaluing it.");
        return { item: it, dados: C.itens[id], troca: best.out, rel: Math.round(best.s.val / full.val * 100), porque: porque + "." + notas };
      });
    const rel = P.reliquias.map(r => ({ item: r.item, dados: C.reliquias.find(x => x.id === r.item.id) || null }));
    return { patch: C.patch, jogos: C.jogos, win: C.win, role: C.role, mesmoRole, anot, faltam, semDados, reliquias: rel, topReliquias: C.reliquias.slice(0, 3), topStarters: C.starters.slice(0, 3),
      vies: this.data.comunidade.vies_ranhura, fonte: this.data.comunidade.fonte, lido: this.data.comunidade.lido_em };
  };

  Engine.prototype.compare = function (opt, itemIds, recBuild) {
    const ctx = this.ctx(opt);
    const gi = Object.fromEntries(this.godItems(opt).map(x => [x.id, x]));
    const items = itemIds.map(id => this.items[id] || gi[id]).filter(Boolean);
    let best = null;
    this.paths(ctx.kit).forEach(p => { const s = this.score(items, p, ctx); if (!best || s.val > best.s.val) best = { p, s }; });
    const rec = this.score(recBuild.itens, recBuild.caminho, ctx);
    const contrib = items.map(it => {
      const without = this.score(items.filter(x => x !== it), best.p, ctx);
      return { item: it, valor: best.s.val - without.val };
    }).sort((a, b) => b.valor - a.valor);
    return { caminho: best.p, rotulo: PL(best.p), score: best.s, rec, relativo: Math.round(best.s.val / rec.val * 100), contrib, ativos: items.filter(i => i.ativo).length };
  };

  root.SmiteEngine = Engine;
  root.SmiteEngine.PATH_LABEL = PATH_LABEL_PT;
  root.SmiteEngine.allowed = allowed;
  if (typeof module !== "undefined") module.exports = Engine;
})(typeof window !== "undefined" ? window : globalThis);
