/* World rules layered on the engine: targeting geometry, surface interactions and triggers, equipment, XP and levelling, loot, DM data.
   Pure functions: state in, new state out. Needs engine.js (DOS2) and data.js (DOS2DATA). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'), require('./data.js'));
  else root.DOS2WORLD = factory(root.DOS2, root.DOS2DATA);
})(this, function (E, D) {
  const rf = E.rf, clone = o => JSON.parse(JSON.stringify(o)), SLOTS = ['weapon', 'shield', 'armour', 'accessory'];
  const nm = c => c.name, key = (x, y) => `${x},${y}`;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------- Equipment (gear is never merged into base stats) ----------
  const itemsOf = c => SLOTS.map(s => D.ITEMS[c.equipment?.[s]]).filter(Boolean);
  // The combatant as the damage engine should see it: gear attributes, weapon damage, shield value and resistances applied on top of the base record.
  function gearView(c) {
    const its = itemsOf(c), v = { ...c, stats: { ...c.stats }, resistances: { ...c.resistances } };
    for (const it of its) {
      for (const [k, n] of Object.entries(it.attrs || {})) v.stats[k] = Math.max(0, (v.stats[k] ?? 10) + n);
      for (const [k, n] of Object.entries(it.resist || {})) v.resistances[k] = (v.resistances[k] || 0) + n;
    }
    const w = D.ITEMS[c.equipment?.weapon]; if (w) { const l = E.levelScaledDamage(c.level); v.weapon = { min: rf(l * w.dmg[0]), max: rf(l * w.dmg[1]) }; }
    const sh = D.ITEMS[c.equipment?.shield]; if (sh) v.shieldPA = E.npcArmour(c.level, sh.paPct);
    return v;
  }
  E.setGear(gearView);
  const gearBonus = c => { const b = { maxVitality: 0, maxPA: 0, maxMA: 0 }; for (const it of itemsOf(c)) { if (it.vitPct) b.maxVitality += E.npcVitality(c.level, it.vitPct); if (it.paPct) b.maxPA += E.npcArmour(c.level, it.paPct); if (it.maPct) b.maxMA += E.npcArmour(c.level, it.maPct); } return b; };
  const withBase = c => c.base ? c : { ...c, base: { maxVitality: c.maxVitality, maxPA: c.maxPA, maxMA: c.maxMA } };
  // Recompute maximums as base + gear; current values are clamped, never topped up.
  function recalc(c) {
    c = withBase(c); const g = gearBonus(c), maxVitality = Math.max(1, c.base.maxVitality + g.maxVitality), maxPA = c.base.maxPA + g.maxPA, maxMA = c.base.maxMA + g.maxMA;
    const vitality = Math.min(c.vitality, maxVitality);
    return { ...c, maxVitality, maxPA, maxMA, vitality, pa: Math.min(c.pa, maxPA), ma: Math.min(c.ma, maxMA), defeated: vitality <= 0 };
  }
  // The UI edits a displayed maximum; store it as base = desired - gear so gear stays separate.
  function setMax(c, which, desired) { c = withBase(c); c = { ...c, base: { ...c.base, [which]: Math.max(which === 'maxVitality' ? 1 : 0, Math.round(desired - gearBonus(c)[which])) } }; return recalc(c); }

  function equip(c, itemId) {
    const it = D.ITEMS[itemId]; if (!it) throw new Error('Unknown item ' + itemId);
    if (!(c.inventory || []).includes(itemId)) throw new Error(`${nm(c)} does not carry ${it.name}`);
    let inv = [...c.inventory], eq = { ...c.equipment };
    inv.splice(inv.indexOf(itemId), 1);
    const bump = slot => { if (eq[slot]) { inv.push(eq[slot]); delete eq[slot]; } };
    bump(it.slot);
    if (it.slot === 'weapon' && it.twoHanded) bump('shield');                                  // two-handers exclude a shield
    if (it.slot === 'shield' && D.ITEMS[eq.weapon]?.twoHanded) bump('weapon');
    eq[it.slot] = itemId; return recalc({ ...c, inventory: inv, equipment: eq });
  }
  function unequip(c, slot) { const id = c.equipment?.[slot]; if (!id) return c; const eq = { ...c.equipment }; delete eq[slot]; return recalc({ ...c, equipment: eq, inventory: [...c.inventory, id] }); }
  const weaponRange = c => D.ITEMS[c.equipment?.weapon]?.range ?? 1.5;

  // ---------- Geometry and targeting ----------
  function areaTiles(shape, size, from, aim, cols, rows) {
    const inb = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows, out = [];
    if (shape === 'single') return inb(aim.x, aim.y) ? [{ x: aim.x, y: aim.y }] : [];
    if (shape === 'radius' || shape === 'around') { const c = shape === 'around' ? from : aim; for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.hypot(x - c.x, y - c.y) <= size + 1e-9) out.push({ x, y }); return out; }
    if (shape === 'line') {
      const dx = aim.x - from.x, dy = aim.y - from.y, len = Math.hypot(dx, dy); if (!len) return [];
      const seen = new Set();
      for (let s = 0.5; s <= size + 1e-9; s += 0.5) { const x = Math.round(from.x + dx / len * s), y = Math.round(from.y + dy / len * s); if (inb(x, y) && !(x === from.x && y === from.y) && !seen.has(key(x, y))) { seen.add(key(x, y)); out.push({ x, y }); } }
      return out;
    }
    return out;
  }
  function geomFor(skill, actor) {
    const g = { shape: 'single', targets: skill.kind === 'heal' || skill.kind === 'utility' ? 'ally' : 'enemy', range: 'weapon', size: 0, friendlyFire: false, ...(D.GEOM[skill.id] || {}) };
    g.range = g.range === 'weapon' ? weaponRange(actor) : g.range; return g;
  }
  const teamOK = (rule, actor, c) => rule === 'any' || (rule === 'enemy' && c.type !== actor.type) || (rule === 'ally' && c.type === actor.type) || (rule === 'self' && c.id === actor.id);
  // aim: {x,y}. Returns {ok, reason, tiles, targetIds, range}. Range is checked here, not in useSkill; the GM override simply ignores a failed plan.
  function planCast(state, actorId, skill, aim, cols, rows) { const r = planCastRaw(state, actorId, skill, aim, cols, rows); if (!r.candidateIds) r.candidateIds = r.targetIds; return r; }
  function planCastRaw(state, actorId, skill, aim, cols, rows) {
    const actor = state.combatants.find(c => c.id === actorId); if (!actor) return { ok: false, reason: 'No such actor', tiles: [], targetIds: [] };
    const g = geomFor(skill, actor), live = state.combatants.filter(c => !c.defeated), fail = reason => ({ ok: false, reason, tiles: [], targetIds: [], range: g.range, shape: g.shape });
    const needsAim = g.shape !== 'around' && g.targets !== 'self'; if (needsAim && !aim) return fail('Click a tile to aim');
    if (g.targets === 'self') return { ok: true, tiles: [{ x: actor.x, y: actor.y }], targetIds: [actor.id], range: 0, shape: g.shape };
    if (g.shape === 'around') { const tiles = areaTiles('around', g.size, actor, actor, cols, rows); return { ok: true, tiles, targetIds: live.filter(c => c.id !== actor.id && teamOK(g.targets, actor, c) && tiles.some(t => t.x === c.x && t.y === c.y)).map(c => c.id), range: g.size, shape: g.shape }; }
    if (g.shape === 'line') {
      if (aim.x === actor.x && aim.y === actor.y) return fail('Aim at a different tile');
      const tiles = areaTiles('line', g.size, actor, aim, cols, rows);
      return { ok: true, tiles, targetIds: live.filter(c => c.id !== actor.id && teamOK(g.targets, actor, c) && tiles.some(t => t.x === c.x && t.y === c.y)).map(c => c.id), range: g.size, shape: g.shape };
    }
    if (g.shape === 'pick') {
      const cand = live.filter(c => c.id !== actor.id && teamOK(g.targets, actor, c) && dist(actor, c) <= g.range + 1e-9).sort((a, b) => dist(actor, a) - dist(actor, b) || (a.id < b.id ? -1 : 1));
      if (!cand.length) return fail(`No valid target within ${g.range} tiles`);
      return { ok: true, candidateIds: cand.map(c => c.id), tiles: cand.map(c => ({ x: c.x, y: c.y })), targetIds: cand.slice(0, skill.maxTargets || 1).map(c => c.id), range: g.range, shape: g.shape };
    }
    const d = dist(actor, aim); if (d > g.range + 1e-9) return fail(`Out of range (${d.toFixed(1)} > ${g.range})`);
    if (g.shape === 'single') {
      const t = live.find(c => c.x === aim.x && c.y === aim.y); if (!t) return fail('No combatant on that tile');
      if (!teamOK(g.targets, actor, t)) return fail(`${skill.name} needs ${g.targets === 'ally' ? 'an ally' : 'an enemy'}`);
      return { ok: true, tiles: [{ x: aim.x, y: aim.y }], targetIds: [t.id], range: g.range, shape: g.shape };
    }
    const tiles = areaTiles('radius', g.size, actor, aim, cols, rows);
    return { ok: true, tiles, targetIds: live.filter(c => tiles.some(t => t.x === c.x && t.y === c.y) && (g.friendlyFire || teamOK(g.targets, actor, c))).map(c => c.id), range: g.range, shape: g.shape };
  }

  // ---------- Surfaces ----------
  // Painting or creating a surface over another one goes through the interaction table. Returns the new map and a message (or null).
  function placeSurface(surfaces, x, y, type) {
    const k = key(x, y), old = surfaces[k], next = { ...surfaces }; let note = null, result = type;
    if (old && old === type) return { surfaces, note: null };
    const rule = old && D.INTERACTIONS[`${old}+${type}`]; if (rule) { result = rule[0]; note = rule[1]; }
    if (result) next[k] = result; else delete next[k];
    return { surfaces: next, note };
  }
  // A surface triggers at most once per combatant, trigger, tile and turn window (stamp). Returns {state, events}.
  function triggerSurface(state, surfaces, id, trigger) {
    const i = state.combatants.findIndex(c => c.id === id); if (i < 0) return { state, events: [] };
    const c = state.combatants[i], sf = surfaces[key(c.x, c.y)]; if (!sf || c.defeated) return { state, events: [] };
    const def = D.SURFACES[sf]; if (!(def.triggers || ['enter', 'start']).includes(trigger)) return { state, events: [] };
    const stamp = `${state.round}|${state.activeId}|${trigger}|${key(c.x, c.y)}|${sf}`; if (c.surfStamp === stamp) return { state, events: [] };
    const r = E.resolveSurface(c, sf, D.SURFACES), combatants = state.combatants.slice(); combatants[i] = { ...r.target, surfStamp: stamp };
    return { state: { ...state, combatants }, events: r.events };
  }

  // ---------- XP and levelling ----------
  const P = D.PROGRESSION, XP = D.XP_TABLE;
  const xpFor = level => XP[Math.max(1, Math.min(level, XP.length - 1))];
  const levelForXp = xp => { let l = 1; while (l < P.maxLevel && xp >= xpFor(l + 1)) l++; return l; };
  const killXp = level => Math.max(1, Math.floor((xpFor(Math.min(level + 1, XP.length - 1)) - xpFor(level)) / P.killXpDivisor));
  const armourRatio = (a, b) => (E.vitalityBoost(b) * (1 + b * 0.07)) / (E.vitalityBoost(a) * (1 + a * 0.07));
  function grantXp(c, amount) {
    if (!(amount >= 0) || !Number.isFinite(amount)) throw new Error('XP must be a non-negative number');
    c = withBase(c); const xp = Math.max(c.xp || 0, xpFor(c.level)) + Math.floor(amount), to = levelForXp(xp), events = [];
    if (to <= c.level) return { c: { ...c, xp }, events, gained: 0 };
    const from = c.level, vr = E.vitalityBoost(to) / E.vitalityBoost(from), ar = armourRatio(from, to), up = to - from, old = c;
    const base = { maxVitality: rf(c.base.maxVitality * vr), maxPA: rf(c.base.maxPA * ar), maxMA: rf(c.base.maxMA * ar) };
    let n = recalc({ ...c, xp, level: to, base, points: { attr: c.points.attr + up * P.attrPointsPerLevel, combat: c.points.combat + up * P.combatPointsPerLevel } });
    const oldMax = { v: old.maxVitality, pa: old.maxPA, ma: old.maxMA };          // keep the same missing amount: level-up adds the growth to current values
    n = { ...n, vitality: Math.min(n.maxVitality, c.vitality + (n.maxVitality - oldMax.v)), pa: Math.min(n.maxPA, c.pa + (n.maxPA - oldMax.pa)), ma: Math.min(n.maxMA, c.ma + (n.maxMA - oldMax.ma)) };
    events.push({ t: 'level', id: c.id, text: `${nm(c)} reaches level ${to}! (+${up * P.attrPointsPerLevel} attribute, +${up * P.combatPointsPerLevel} combat points)` });
    return { c: n, events, gained: up };
  }
  function spendPoint(c, kind, name) {
    if (kind === 'attr') { if (!['STR', 'FIN', 'INT'].includes(name)) throw new Error('Unknown attribute'); if (c.points.attr < 1) throw new Error('No attribute points left'); return { ...c, stats: { ...c.stats, [name]: c.stats[name] + 1 }, points: { ...c.points, attr: c.points.attr - 1 } }; }
    if (kind === 'combat') { if (c.points.combat < 1) throw new Error('No combat points left'); if ((c.abilities[name] || 0) >= P.abilityCap) throw new Error('Ability is at its cap'); return { ...c, abilities: { ...c.abilities, [name]: (c.abilities[name] || 0) + 1 }, points: { ...c.points, combat: c.points.combat - 1 } }; }
    throw new Error('Unknown point type');
  }

  // ---------- Loot and rewards ----------
  function rollLoot(tableId, level, rng) {
    const t = D.LOOT[tableId]; if (!t) return { gold: 0, items: [] };
    const gold = rf((t.gold[0] + Math.floor(rng() * (t.gold[1] - t.gold[0] + 1))) * Math.max(1, level) * 0.5 + 0.0001);
    return { gold, items: t.drops.filter(d => rng() < d.chance).map(d => d.item) };
  }
  const emptyDm = () => ({ pendingXp: 0, pendingLoot: [], gold: 0, npcs: [], quests: [], session: '', encNotes: '' });
  // Each defeated enemy pays out exactly once (c.rewarded). Mutations are returned, not applied in place.
  function collectRewards(state, dm, rng) {
    const events = []; let out = { ...dm, pendingLoot: [...dm.pendingLoot] }; const combatants = state.combatants.map(c => {
      if (c.type !== 'enemy' || !c.defeated || c.rewarded) return c;
      const xp = c.xpReward ?? killXp(c.level), l = rollLoot(c.loot, c.level, rng);
      out.pendingXp += xp; out.gold += l.gold; out.pendingLoot.push(...l.items);
      events.push({ t: 'reward', id: c.id, text: `${nm(c)} defeated: ${xp} XP, ${l.gold} gold${l.items.length ? ', loot: ' + l.items.map(i => D.ITEMS[i].name).join(', ') : ''}` });
      return { ...c, rewarded: true };
    });
    return { state: events.length ? { ...state, combatants } : state, dm: out, events };
  }
  function distributeXp(state, dm) {
    const heirs = state.combatants.filter(c => c.type === 'player' && !c.defeated), events = [];
    if (!heirs.length) return { state, dm, events: [{ t: 'info', text: 'No living players to receive XP.' }] };
    if (dm.pendingXp <= 0) return { state, dm, events: [{ t: 'info', text: 'No XP waiting.' }] };
    const share = Math.floor(dm.pendingXp / heirs.length), spare = dm.pendingXp - share * heirs.length, got = new Map(heirs.map((c, i) => [c.id, share + (i === 0 ? spare : 0)]));
    const combatants = state.combatants.map(c => { if (!got.has(c.id)) return c; const r = grantXp(c, got.get(c.id)); events.push({ t: 'xp', id: c.id, text: `${nm(c)} gains ${got.get(c.id)} XP`, }, ...r.events); return r.c; });
    return { state: { ...state, combatants }, dm: { ...dm, pendingXp: 0 }, events };
  }
  function awardLoot(state, dm, index, toId) {
    const item = dm.pendingLoot[index], i = state.combatants.findIndex(c => c.id === toId);
    if (!item) throw new Error('No such loot'); if (i < 0) throw new Error('No such recipient');
    const combatants = state.combatants.slice(); combatants[i] = { ...combatants[i], inventory: [...combatants[i].inventory, item] };
    return { state: { ...state, combatants }, dm: { ...dm, pendingLoot: dm.pendingLoot.filter((_, k) => k !== index) }, events: [{ t: 'loot', id: toId, text: `${nm(combatants[i])} receives ${D.ITEMS[item].name}` }] };
  }
  function normalizeDm(raw) {
    const d = emptyDm(); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
    const n0 = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0), s = (v, m) => (typeof v === 'string' ? v.slice(0, m) : '');
    d.pendingXp = n0(raw.pendingXp); d.gold = n0(raw.gold); d.session = s(raw.session, 20000); d.encNotes = s(raw.encNotes, 5000);
    d.pendingLoot = (Array.isArray(raw.pendingLoot) ? raw.pendingLoot : []).filter(i => typeof i === 'string' && D.ITEMS[i]).slice(0, 200);
    d.npcs = (Array.isArray(raw.npcs) ? raw.npcs : []).filter(x => x && typeof x === 'object').slice(0, 200).map((x, i) => ({ id: s(x.id, 20) || 'n' + i, name: s(x.name, 60) || 'Unnamed NPC', notes: s(x.notes, 3000) }));
    d.quests = (Array.isArray(raw.quests) ? raw.quests : []).filter(x => x && typeof x === 'object').slice(0, 200).map((x, i) => ({ id: s(x.id, 20) || 'q' + i, title: s(x.title, 80) || 'Untitled quest', status: ['open', 'done', 'failed'].includes(x.status) ? x.status : 'open', notes: s(x.notes, 3000) }));
    return d;
  }

  // ---------- Player view ----------
  const visible = (c, dmView) => dmView || !c.hidden;

  return { SLOTS, dist, gearView, gearBonus, recalc, setMax, equip, unequip, weaponRange, areaTiles, geomFor, planCast, placeSurface, triggerSurface,
    xpFor, levelForXp, killXp, grantXp, spendPoint, rollLoot, emptyDm, collectRewards, distributeXp, awardLoot, normalizeDm, visible };
});
