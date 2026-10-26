/* DOS2-inspired combat engine. Pure functions: no DOM, no hidden state, injectable RNG.
   Constants are labelled V (verified in a cited source), P (provisional) or T (tabletop adaptation). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DOS2 = factory();
})(this, function () {
  const CONFIG = {
    attrBase: 10,          // P: attribute value that gives 0% bonus (Formulas.md AttributeBaseValue = 10 is V; +5%/point is P)
    attrPct: 5,            // P: % damage per attribute point above base
    abilityPct: 5,         // P: % damage per ability rank (dos2 wiki Warfare page: +5% per point is V for Warfare)
    critPct: 50,           // P: bonus applied only on a critical hit
    levelRange: 0.05,      // P: level-scaled skills roll within +/-5% of levelScaledDamage
    overflowToVitality: true, // T: damage beyond armour spills into Vitality (50 MA + 100 magic = 50 Vitality)
    apPerTurn: 4,          // T: AP gained at turn start
    maxAP: 6               // T: AP cap
  };
  // T: two damage categories. Physical -> Physical Armour; Magic (elemental subtypes kept for resistances) -> Magic Armour.
  const ARMOUR = { Physical: 'pa', Magic: 'ma', Fire: 'ma', Water: 'ma', Air: 'ma', Earth: 'ma', Poison: 'ma' };
  const rf = x => Math.floor(x + 0.5);
  const num = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name} must be a finite number`); return v; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const nm = x => x.name || x.id;

  function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ---------- Level scaling (V: Formulas.md, Norbyte, DE) ----------
  function vitalityBoost(level) {
    let exp = Math.pow(1.25, level - 1);
    for (const [lv, g] of [[9, 1.25], [13, 1.25], [16, 1.25], [18, 1.35]]) if (level >= lv) exp = exp * g / 1.25;
    return rf(level * 9.091 + 21 * exp) / 5 * 5.0;
  }
  function levelScaledDamage(level) { num(level, 'level'); level = Math.max(1, Math.floor(level)); return vitalityBoost(level) / ((level - 1) * 0.2 + 5); }
  function healScaling(level, healValue) {
    const l = levelScaledDamage(level), b = level * 0.015 + 1;
    return rf(num(healValue, 'healValue') * (b * l) * b * 1.3 / 100);
  }
  // NPC scaling. Vitality: V (Formulas.md "Vitality Scaling"). Armour: P (printed formula has a misplaced bracket; read as vitalityBoost*(1+level*0.07)*0.55).
  const npcVitality = (level, pct) => rf(vitalityBoost(level) * pct / 100);
  const npcArmour = (level, pct) => rf(vitalityBoost(level) * (1 + level * 0.07) * 0.55 * pct / 100);
  // V: "Attribute Growth (Level Mapped)" and "Ability Growth" in Formulas.md
  const npcAttribute = (v, level) => Math.round(Math.ceil((v - 1) / 100 * (2 + 0.75) * level) * 0.7) + 10;
  const npcAbility = (v, level) => Math.min(rf(level * v * 0.1), 10);

  // ---------- Status effects (central table) ----------
  // gate: armour pool that must be 0 for the status to apply (dos2.wiki: Burning blocked by MA, Bleeding by PA).
  // tick.pct is a share of levelScaledDamage(source level): value not published -> T. bypassArmour: official bleeding is piercing.
  const STATUS = {
    burning:   { name: 'Burning',    duration: 2, resist: { Fire: -15, Water: 10 }, gate: 'ma', tick: { pct: 0.25, type: 'Fire' },   removedBy: ['water'], note: '2 turns, MA blocks, tick at start of turn (dos2.wiki Burning). Tick size T.' },
    poisoned:  { name: 'Poisoned',   duration: 2, gate: 'ma', tick: { pct: 0.25, type: 'Poison' }, removedBy: ['cleanse'], note: 'P: duration, tick size and gate not confirmed.' },
    bleeding:  { name: 'Bleeding',   duration: 3, gate: 'pa', tick: { pct: 0.20, bypassArmour: true }, removedBy: ['cleanse'], note: 'PA blocks; damage ignores armour (dos2.wiki Bleeding). Duration 3 from one item only: P. Tick size T.' },
    crippled:  { name: 'Crippled',   duration: 1, gate: 'pa', note: '1 turn from Crippling Blow (GameFAQs). Movement penalty is not modelled.' },
    knockedDown: { name: 'Knocked Down', duration: 1, gate: 'pa', skipsTurn: true, note: '1 turn (GameFAQs). Skipping the turn is T.' },
    slowed:    { name: 'Slowed',     duration: 2, gate: 'ma', apMod: -1, note: '2 turns from oil (dos2.wiki Fossil Strike). -1 AP and gate are P.' },
    wet:       { name: 'Wet',       duration: 2, gate: null, resist: { Fire: 10, Water: -10, Air: -20 }, cancels: ['burning'], note: 'Resistance changes from the OS2 wiki Status Effects page. Duration not published: P. Wet cures Burning and blocks it (T).' },
    chilled:   { name: 'Chilled',   duration: 2, gate: 'ma', resist: { Fire: 10, Water: -20, Air: -10 }, note: 'Resistances from the OS2 wiki. Movement -35% and Dodging -30% are not modelled. Duration P.' },
    frozen:    { name: 'Frozen',    duration: 1, gate: 'ma', skipsTurn: true, resist: { Fire: 10, Water: -20 }, immuneWhile: ['bleeding', 'poisoned', 'shocked', 'stunned'], note: 'Resistances and immunities from the OS2 wiki. Losing the turn and duration are T/P.' },
    shocked:   { name: 'Shocked',   duration: 2, gate: 'ma', apMod: -1, resist: { Earth: 10, Air: -15 }, note: 'AP Recovery -1 and resistances from the OS2 wiki. A second Shocked, or Shocked on a Wet target, also Stuns (wiki). Duration P.' },
    stunned:   { name: 'Stunned',   duration: 1, gate: null, skipsTurn: true, resist: { Earth: 10, Air: -15 }, note: 'Resistances from the OS2 wiki. Losing the turn is T; duration P.' },
    hasted:    { name: 'Hasted',     duration: 2, gate: null, apMod: 1, clears: ['crippled', 'slowed'], note: '2 turns, clears Crippled/Slowed (GameFAQs Haste). +1 AP is P.' }
  };

  let gearFn = x => x;                                   // world.js installs the equipment view here
  const setGear = fn => { gearFn = fn || (x => x); };
  const statusResist = (t, type) => (t.statuses || []).reduce((n, s) => n + (STATUS[s.id]?.resist?.[type] || 0), 0);
  const totalResist = (t, type) => Math.max(-200, Math.min(200, ((gearFn(t).resistances || {})[type] || 0) + statusResist(t, type)));

  function applyStatus(t, id, opts = {}) {
    const def = STATUS[id]; if (!def) throw new Error('Unknown status ' + id);
    if ((t.immune || []).includes(id)) return { target: t, applied: false, reason: 'immune' };
    for (const s of t.statuses || []) if ((STATUS[s.id]?.immuneWhile || []).includes(id)) return { target: t, applied: false, reason: 'immune while ' + STATUS[s.id].name };
    if (id === 'burning' && (t.statuses || []).some(s => s.id === 'wet')) return { target: removeStatuses(t, s => s.id === 'wet'), applied: false, reason: 'Wet is put out instead (T)' };
    if (def.gate && t[def.gate] > 0 && !opts.ignoreGate) return { target: t, applied: false, reason: (def.gate === 'pa' ? 'Physical' : 'Magic') + ' Armour still up' };
    const turns = opts.duration ?? def.duration, src = opts.sourceLevel ?? t.level;
    let list = (t.statuses || []).filter(s => !(def.clears || []).includes(s.id));
    const ex = list.find(s => s.id === id);
    if (ex) list = list.map(s => s.id === id ? { ...s, turns: Math.max(s.turns, turns), sourceLevel: src } : s); // refresh, no stacking
    else list = [...list, { id, turns, sourceLevel: src }];
    list = list.filter(s => s.id === id || !(def.cancels || []).includes(s.id));
    const extra = [];
    if (id === 'shocked' && !opts.noChain && (ex || list.some(s => s.id === 'wet'))) { const r = applyStatus({ ...t, statuses: list }, 'stunned', { sourceLevel: src, noChain: true }); if (r.applied) { list = r.target.statuses; extra.push('stunned'); } }
    return { target: { ...t, statuses: list }, applied: true, extra };
  }
  function removeStatuses(t, pred) { return { ...t, statuses: (t.statuses || []).filter(s => !pred(s)) }; }
  const cleanseBy = (t, tag) => removeStatuses(t, s => (STATUS[s.id]?.removedBy || []).includes(tag));

  // ---------- Damage ----------
  // Returns every factor so the UI can show the breakdown. skill.kind: weapon | shield | level | heal
  function calcSkill(skill, atk, opts = {}, rng = Math.random, cfg = {}) {
    const c = { ...CONFIG, ...cfg };
    num(atk.level, 'attacker.level'); num(skill.mult ?? 1, 'skill.mult');
    const lvl = Math.max(1, Math.floor(atk.level)), hits = skill.hits || 1, mult = skill.mult ?? 1, st = atk.stats || {}, ab = atk.abilities || {};
    const o = { gear: 0, weapon: 0, misc: 0, highGround: 0, crit: false, resist: 0, ...opts };
    if (!(skill.type === 'Heal' || skill.type in ARMOUR)) throw new Error('Unknown damage type ' + skill.type);
    if (skill.kind === 'heal') {
      if (skill.healValue == null) throw new Error('heal skill needs healValue');
      const amt = healScaling(lvl, skill.healValue);
      return { kind: 'heal', type: 'Heal', hits: [{ amount: amt }], total: amt, factors: [{ name: 'Heal scaling (Formulas.md)', value: amt }] };
    }
    const [r0, r1] = skill.multRange || [mult, mult];
    let lo, hi;
    if (skill.kind === 'weapon') { lo = num(atk.weaponMin, 'weaponMin') * r0; hi = num(atk.weaponMax, 'weaponMax') * r1; }
    else if (skill.kind === 'shield') { lo = num(atk.shieldPA, 'shieldPA') * r0; hi = atk.shieldPA * r1; }
    else if (skill.kind === 'level') {
      const b = levelScaledDamage(lvl);
      if (skill.multRange) { lo = b * r0; hi = b * r1; } else { lo = b * (1 - c.levelRange) * mult; hi = b * (1 + c.levelRange) * mult; }
    } else throw new Error('Unknown skill kind ' + skill.kind);
    if (hi < lo) throw new Error('weaponMax < weaponMin');
    const statName = skill.attr === 'weapon' ? (skill.type === 'Physical' ? ((st.STR || 0) >= (st.FIN || 0) ? 'STR' : 'FIN') : 'INT') : skill.attr;
    const attr = skill.attr === 'none' ? 0 : Math.max(0, (st[statName] ?? c.attrBase) - c.attrBase) * c.attrPct;
    const abil = (ab[skill.ability] || 0) * c.abilityPct;
    const critPct = o.crit ? c.critPct : 0;
    const weaponLike = skill.kind === 'weapon' || skill.kind === 'shield';
    // Order per Fextralife "Damage": weapon = (1+elem)(1+attr+skill+misc)(1+hg+crit); spell = (1+elem)(1+attr)(1+misc)(1+hg+crit).
    // Where the school ability sits for spells is unconfirmed: kept with attribute (P).
    const factors = weaponLike
      ? [['Elemental gear', 1 + o.gear / 100], ['Attribute+ability+weapon+misc', 1 + (attr + abil + o.weapon + o.misc) / 100], ['High ground+crit', 1 + (o.highGround + critPct) / 100]]
      : [['Elemental gear', 1 + o.gear / 100], ['Attribute+ability+weapon', 1 + (attr + abil + o.weapon) / 100], ['Misc spell', 1 + o.misc / 100], ['High ground+crit', 1 + (o.highGround + critPct) / 100]];
    const m = factors.reduce((p, f) => p * f[1], 1);
    const out = [];
    for (let i = 0; i < hits; i++) {            // each hit rolls independently
      const roll = lo + (hi - lo) * rng(), amount = Math.max(0, rf(roll * m));
      out.push({ roll, amount, afterResist: rf(amount * (1 - o.resist / 100)) });
    }
    return { kind: 'damage', type: skill.type, base: [lo, hi], hits: out, total: out.reduce((s, h) => s + h.afterResist, 0), factors: factors.map(f => ({ name: f[0], value: f[1] })), multiplier: m };
  }
  const damageRange = (skill, atk, opts, cfg) => ({ min: calcSkill(skill, atk, opts, () => 0, cfg).total, avg: calcSkill(skill, atk, opts, () => 0.5, cfg).total, max: calcSkill(skill, atk, opts, () => 1, cfg).total });
  const attackerOf = a => ({ level: a.level, stats: a.stats || {}, abilities: a.abilities || {}, weaponMin: a.weapon?.min ?? 0, weaponMax: a.weapon?.max ?? 0, shieldPA: a.shieldPA ?? 0 });

  // Returns a NEW target; negative amount (resistance > 100%) heals.
  function applyDamage(t, amount, type, cfg = {}) {
    const c = { ...CONFIG, ...cfg }, n = { ...t }; num(amount, 'amount');
    if (amount < 0) { const h = Math.min(n.maxVitality - n.vitality, -amount); n.vitality += h; return { target: n, result: { absorbed: 0, vitality: 0, healed: h } }; }
    if (!(type in ARMOUR)) throw new Error('Unknown damage type ' + type);
    const pool = ARMOUR[type]; let rem = amount, abs = 0;
    if (pool) { abs = Math.min(n[pool], rem); n[pool] -= abs; rem -= abs; if (!c.overflowToVitality && abs > 0) rem = 0; }
    const vl = Math.min(n.vitality, rem); n.vitality -= vl; n.defeated = n.vitality <= 0;
    return { target: n, result: { absorbed: abs, vitality: vl, healed: 0 } };
  }
  function applyDirect(t, amount) { const n = { ...t }, v = Math.min(n.vitality, Math.max(0, amount)); n.vitality -= v; n.defeated = n.vitality <= 0; return { target: n, result: { absorbed: 0, vitality: v, healed: 0 } }; }
  function heal(t, amount) { const n = { ...t }, h = Math.max(0, Math.min(n.maxVitality - n.vitality, amount)); n.vitality += h; if (n.vitality > 0) n.defeated = false; return { target: n, healed: h }; }

  // ---------- Turns and AP ----------
  // T: higher initiative first; tie -> players before enemies; tie -> id (deterministic).
  const sortInitiative = list => [...list].sort((a, b) => (b.initiative - a.initiative) || (a.type === b.type ? 0 : a.type === 'player' ? -1 : 1) || (a.id < b.id ? -1 : 1));
  function spendAP(x, cost, override = false) {
    num(cost, 'cost');
    if (!override && x.ap < cost) return { ok: false, reason: `needs ${cost} AP, has ${x.ap}`, combatant: x };
    return { ok: true, combatant: { ...x, ap: Math.max(0, x.ap - cost) } };
  }

  // Start-of-turn processing for one combatant: cooldowns tick down, statuses tick then lose a turn.
  function startTurn(x, c) {
    x = { ...x, statuses: (x.statuses || []).map(s => ({ ...s })), cooldowns: { ...(x.cooldowns || {}) } };
    const events = []; let skip = false, apMod = 0;
    for (const k of Object.keys(x.cooldowns)) if (x.cooldowns[k] > 0) x.cooldowns[k]--;
    const keep = [];
    for (const s of x.statuses) {
      const def = STATUS[s.id]; if (!def) continue;
      apMod += def.apMod || 0;
      if (def.skipsTurn) skip = true;
      if (def.tick && !x.defeated) {
        const amount = Math.max(1, rf(levelScaledDamage(s.sourceLevel || x.level) * def.tick.pct));
        const r = def.tick.bypassArmour ? applyDirect(x, amount) : applyDamage(x, amount, def.tick.type, c);
        x = r.target;
        events.push({ t: 'tick', id: x.id, status: s.id, amount, text: `${nm(x)} takes ${amount} ${def.tick.bypassArmour ? 'armour-ignoring' : def.tick.type} damage from ${def.name} (armour ${r.result.absorbed}, Vitality ${r.result.vitality})` });
      }
      s.turns--;
      if (s.turns > 0) keep.push(s); else events.push({ t: 'expired', id: x.id, status: s.id, text: `${def.name} wears off ${nm(x)}` });
    }
    x.statuses = keep;
    return { x, events, skip, apMod };
  }

  // The ONLY place AP is granted. Skips defeated and skipNext combatants. state: {round, activeId, combatants[]}
  function nextTurn(s, cfg = {}) {
    const c = { ...CONFIG, ...cfg }, list = s.combatants.map(x => ({ ...x })), events = [];
    if (!list.some(x => !x.defeated)) return { state: { ...s, combatants: list }, events: [{ t: 'no-active', text: 'Nobody is able to act.' }] };
    let i = list.findIndex(x => x.id === s.activeId), round = s.round;
    for (let g = 0; g < list.length * 2 + 2; g++) {
      i++; if (i >= list.length) { i = 0; round++; }
      if (list[i].defeated) continue;
      if (list[i].skipNext) { list[i].skipNext = false; events.push({ t: 'skipped', id: list[i].id, text: `${nm(list[i])}'s turn is skipped` }); continue; }
      const st = startTurn(list[i], c); list[i] = st.x; events.push(...st.events);
      const x = list[i];
      if (x.defeated) { events.push({ t: 'defeated', id: x.id, text: `${nm(x)} is defeated` }); continue; }
      if (st.skip) { events.push({ t: 'skipped', id: x.id, text: `${nm(x)} loses the turn (Knocked Down)` }); continue; }
      const before = x.ap, cap = x.maxAP ?? c.maxAP;
      if (x.ap < cap) x.ap = Math.min(cap, x.ap + Math.max(0, (x.apPerTurn ?? c.apPerTurn) + st.apMod));
      events.push({ t: 'turn', id: x.id, round, apGained: x.ap - before, text: `Round ${round}: ${nm(x)}'s turn (+${x.ap - before} AP, now ${x.ap})` });
      return { state: { ...s, round, activeId: x.id, combatants: list }, events };
    }
    return { state: { ...s, combatants: list }, events: [{ t: 'no-active', text: 'Nobody is able to act.' }] };
  }

  // ---------- Using a skill: the single path that spends AP, rolls, applies damage and statuses ----------
  // opts: { override, crit, highGround, gear, weapon, misc }. Returns { ok, reason, state, events, results }.
  function useSkill(state, actorId, skill, targetIds, opts = {}, rng = Math.random, cfg = {}) {
    const c = { ...CONFIG, ...cfg }, s = clone(state), events = [], results = [];
    const fail = reason => ({ ok: false, reason, state, events: [], results: [] });
    const ai = s.combatants.findIndex(x => x.id === actorId); if (ai < 0) return fail('No such actor');
    const actor = s.combatants[ai], ov = !!opts.override, ids = [...new Set(targetIds || [])];
    if (!ov) {
      if (actor.defeated) return fail(`${nm(actor)} is defeated`);
      if (s.activeId && s.activeId !== actorId) return fail(`It is not ${nm(actor)}'s turn`);
      if (actor.skills && !actor.skills.includes(skill.id)) return fail(`${nm(actor)} does not know ${skill.name}`);
      if (actor.ap < skill.ap) return fail(`${skill.name} needs ${skill.ap} AP, ${nm(actor)} has ${actor.ap}`);
      if ((actor.cooldowns?.[skill.id] || 0) > 0) return fail(`${skill.name} is on cooldown (${actor.cooldowns[skill.id]})`);
      if (!ids.length) return fail('Choose at least one target');
      if (skill.maxTargets && ids.length > skill.maxTargets) return fail(`${skill.name} hits at most ${skill.maxTargets} targets`);
    }
    for (const id of ids) {
      const ti = s.combatants.findIndex(x => x.id === id); if (ti < 0) return fail('Unknown target');
      if (s.combatants[ti].defeated && !ov) return fail(`${nm(s.combatants[ti])} is already defeated`);
    }
    events.push({ t: 'skill', id: actorId, text: `${nm(actor)} uses ${skill.name} (${skill.ap} AP)` });
    const mods = Object.fromEntries(['crit', 'highGround', 'gear', 'weapon', 'misc'].filter(k => opts[k] !== undefined).map(k => [k, opts[k]]));
    for (const id of ids) {
      const ti = s.combatants.findIndex(x => x.id === id); let t = s.combatants[ti];
      const res = { targetId: id, calc: null, absorbed: 0, vitality: 0, healed: 0, restored: 0, statuses: [] };
      if (skill.kind === 'restore') {            // armour restoration: pct of the target's max armour in one pool (amount is P/T)
        const pool = skill.pool === 'ma' ? 'ma' : 'pa', mx = pool === 'pa' ? t.maxPA : t.maxMA, add = Math.max(0, Math.min(mx - t[pool], rf(mx * (skill.pct || 0) / 100)));
        t = { ...t, [pool]: t[pool] + add }; res.restored = add;
        events.push({ t: 'restore', id, text: `${nm(t)} regains ${add} ${pool === 'pa' ? 'Physical' : 'Magic'} Armour` });
      }
      if (skill.kind !== 'utility' && skill.kind !== 'restore') {
        const calc = calcSkill(skill, attackerOf(gearFn(s.combatants[ai])), { ...mods, resist: skill.kind === 'heal' ? 0 : totalResist(t, skill.type) }, rng, c);
        res.calc = calc;
        if (calc.kind === 'heal') { const h = heal(t, calc.total); t = h.target; res.healed = h.healed; events.push({ t: 'heal', id, text: `${nm(t)} heals ${h.healed} Vitality` }); }
        else {
          for (const h of calc.hits) { const r = applyDamage(t, h.afterResist, skill.type, c); t = r.target; res.absorbed += r.result.absorbed; res.vitality += r.result.vitality; res.healed += r.result.healed; }
          events.push({ t: 'damage', id, text: `${nm(t)} takes ${calc.total} ${skill.type} (${calc.hits.map(h => h.afterResist).join('+')}); ${res.absorbed} armour absorbed, ${res.vitality} Vitality lost` });
          if (t.defeated) events.push({ t: 'defeated', id, text: `${nm(t)} is defeated` });
        }
      }
      if (skill.cures && !t.defeated) {
        const before = t.statuses.length; t = removeStatuses(t, s => skill.cures.includes(s.id));
        if (t.statuses.length < before) events.push({ t: 'cure', id, text: `${nm(t)} is cleansed (${skill.cures.map(k => STATUS[k]?.name || k).join(', ')} removed if present)` });
      }
      if (!t.defeated) for (const sd of skill.statuses || []) {
        const r = applyStatus(t, sd.id, { duration: sd.duration, sourceLevel: actor.level }); t = r.target;
        res.statuses.push({ id: sd.id, applied: r.applied, reason: r.reason });
        events.push({ t: r.applied ? 'status' : 'resisted', id, text: r.applied ? `${nm(t)} is ${STATUS[sd.id].name}${(r.extra || []).length ? ' and ' + r.extra.map(k => STATUS[k].name).join(', ') : ''}` : `${nm(t)} resists ${STATUS[sd.id].name} (${r.reason})` });
      }
      s.combatants[ti] = t; results.push(res);
    }
    const a2 = s.combatants.findIndex(x => x.id === actorId), a = s.combatants[a2];
    s.combatants[a2] = { ...a, ap: Math.max(0, a.ap - skill.ap), cooldowns: skill.cooldown ? { ...(a.cooldowns || {}), [skill.id]: skill.cooldown } : (a.cooldowns || {}) };
    return { ok: true, state: s, events, results };
  }

  // ---------- Surfaces (tabletop adaptation; table lives in data.js so it is configurable) ----------
  function resolveSurface(t, key, table) {
    const sf = table[key]; if (!sf) throw new Error('Unknown surface ' + key);
    if (sf.heal) { const amt = Math.max(sf.heal.min ?? 0, sf.heal.perLevel * t.level), h = heal(t, amt); return { target: h.target, events: [{ t: 'surface', id: t.id, text: `${nm(t)} heals ${h.healed} from ${sf.label}` }] }; }
    const dmg = (sf.base || 0) + (sf.perLevel || 0) * t.level + (sf.flat || 0), events = []; let out = t;
    if (dmg) { const r = applyDamage(t, dmg, sf.type); out = r.target; events.push({ t: 'surface', id: t.id, text: `${nm(t)} takes ${dmg} ${sf.type} from ${sf.label} (armour ${r.result.absorbed}, Vitality ${r.result.vitality})` }); if (out.defeated) events.push({ t: 'defeated', id: t.id, text: `${nm(out)} is defeated` }); }
    else if (!sf.status) events.push({ t: 'surface', id: t.id, text: `${sf.label} has no direct effect` });
    if (sf.status && !out.defeated) { const r = applyStatus(out, sf.status, { sourceLevel: out.level }); out = r.target; events.push({ t: r.applied ? 'status' : 'resisted', id: t.id, text: r.applied ? `${nm(out)} is ${STATUS[sf.status].name} (${sf.label})` : `${nm(out)} resists ${STATUS[sf.status].name} (${r.reason})` }); }
    return { target: out, events };
  }

  // ---------- Combatants, templates, save format ----------
  function normalizeCombatant(p, cfg = {}) {
    if (!p || typeof p !== 'object') throw new TypeError('combatant must be an object');
    const c = { ...CONFIG, ...cfg }, N = (v, d, min = -Infinity) => { const x = Number(v); return (v === '' || v === null || v === undefined || !Number.isFinite(x)) ? d : Math.max(min, x); };
    const level = Math.floor(N(p.level, 1, 1)), maxVitality = Math.max(1, N(p.maxVitality, N(p.vitality, 100)));
    const maxPA = N(p.maxPA, N(p.pa, 0, 0), 0), maxMA = N(p.maxMA, N(p.ma, 0, 0), 0), maxAP = N(p.maxAP, c.maxAP, 0);
    const mapNums = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
    const wmin = N(p.weapon?.min, 0, 0), vit = Math.min(maxVitality, N(p.vitality, maxVitality, 0));
    return {
      id: String(p.id || uid()), name: String(p.name || 'Unnamed').slice(0, 40), type: p.type === 'enemy' ? 'enemy' : 'player', level,
      x: Math.floor(N(p.x, 0, 0)), y: Math.floor(N(p.y, 0, 0)), portrait: typeof p.portrait === 'string' ? p.portrait : '',
      vitality: vit, maxVitality, pa: Math.min(maxPA, N(p.pa, maxPA, 0)), maxPA, ma: Math.min(maxMA, N(p.ma, maxMA, 0)), maxMA,
      ap: Math.min(maxAP, N(p.ap, 0, 0)), maxAP, apPerTurn: N(p.apPerTurn, c.apPerTurn, 0), initiative: N(p.initiative, 10),
      stats: { STR: N(p.stats?.STR, 10, 0), FIN: N(p.stats?.FIN, 10, 0), INT: N(p.stats?.INT, 10, 0) },
      abilities: mapNums(p.abilities), weapon: { min: wmin, max: Math.max(wmin, N(p.weapon?.max, wmin, 0)) }, shieldPA: N(p.shieldPA, 0, 0),
      resistances: mapNums(p.resistances), immune: Array.isArray(p.immune) ? p.immune.filter(i => STATUS[i]) : [], skills: Array.isArray(p.skills) ? p.skills.map(String) : [],
      statuses: (Array.isArray(p.statuses) ? p.statuses : []).filter(s => s && STATUS[s.id] && Number(s.turns) > 0).map(s => ({ id: s.id, turns: Number(s.turns), sourceLevel: N(s.sourceLevel, level, 1) })),
      cooldowns: mapNums(p.cooldowns), defeated: !!p.defeated || vit <= 0, skipNext: !!p.skipNext,
      equipment: Object.fromEntries(['weapon', 'shield', 'armour', 'accessory'].filter(k => typeof p.equipment?.[k] === 'string').map(k => [k, p.equipment[k]])),
      inventory: Array.isArray(p.inventory) ? p.inventory.filter(i => typeof i === 'string').slice(0, 200) : [],
      base: p.base && typeof p.base === 'object' ? { maxVitality: N(p.base.maxVitality, maxVitality, 1), maxPA: N(p.base.maxPA, maxPA, 0), maxMA: N(p.base.maxMA, maxMA, 0) } : null,
      xp: N(p.xp, 0, 0), points: { attr: Math.floor(N(p.points?.attr, 0, 0)), combat: Math.floor(N(p.points?.combat, 0, 0)) },
      hidden: !!p.hidden, rewarded: !!p.rewarded, xpReward: p.xpReward == null ? null : N(p.xpReward, 0, 0), loot: typeof p.loot === 'string' ? p.loot : '',
      notes: typeof p.notes === 'string' ? p.notes.slice(0, 2000) : '', surfStamp: typeof p.surfStamp === 'string' ? p.surfStamp : ''
    };
  }

  // tpl: {name, vit, pa, ma, attrs:{STR,FIN,INT}, abilities:{k:v}, skills[], initiative, weapon:[lo,hi] as share of levelScaledDamage}
  function buildEnemy(tpl, level, id) {
    const l = levelScaledDamage(level), w = tpl.weapon || [0.9, 1.1];
    return normalizeCombatant({
      id, name: tpl.name, type: 'enemy', level,
      maxVitality: npcVitality(level, tpl.vit), maxPA: npcArmour(level, tpl.pa), maxMA: npcArmour(level, tpl.ma), apPerTurn: tpl.apPerTurn,
      stats: Object.fromEntries(Object.entries(tpl.attrs).map(([k, v]) => [k, npcAttribute(v, level)])),
      abilities: Object.fromEntries(Object.entries(tpl.abilities || {}).map(([k, v]) => [k, npcAbility(v, level)])),
      weapon: { min: rf(l * w[0]), max: rf(l * w[1]) }, shieldPA: tpl.shield ? npcArmour(level, tpl.shield) : 0,
      skills: tpl.skills, initiative: tpl.initiative ?? 10, resistances: tpl.resistances
    });
  }

  function createHistory(limit = 100) {
    const stack = [];
    return { push(s) { stack.push(JSON.stringify(s)); if (stack.length > limit) stack.shift(); }, undo() { return stack.length ? JSON.parse(stack.pop()) : null; }, size: () => stack.length, clear() { stack.length = 0; } };
  }

  function migrateV1(d) {
    const combatants = (Array.isArray(d.combatants) ? d.combatants : []).map(c => ({ ...c, maxPA: c.pa, maxMA: c.ma }));
    const surfaces = {}; (Array.isArray(d.tiles) ? d.tiles : []).forEach(t => { if (t && t.surface) surfaces[`${t.x},${t.y}`] = t.surface; });
    return { format: 'battleboard-v2', name: d.name, cols: d.cols, rows: d.rows, surfaces, log: [], settings: {}, state: { round: d.round, activeId: combatants[d.turnIndex]?.id ?? null, combatants } };
  }
  function serializeSave(x) { return { format: 'battleboard-v2', version: 2, name: x.name, cols: x.cols, rows: x.rows, surfaces: x.surfaces, log: x.log, settings: x.settings, state: x.state, dm: x.dm }; }
  // Throws on malformed input. validSurfaces: list of allowed surface keys. Returns a clean, normalised encounter plus warnings.
  function loadSave(raw, validSurfaces = []) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not an encounter file');
    let d = raw; if (d.format === 'battleboard-v1') d = migrateV1(d);
    if (d.format !== 'battleboard-v2') throw new Error('Unsupported file format');
    const cols = Number(d.cols), rows = Number(d.rows), warnings = [];
    if (!Number.isInteger(cols) || cols < 6 || cols > 30 || !Number.isInteger(rows) || rows < 6 || rows > 24) throw new Error('Grid size is missing or out of range');
    const st = d.state; if (!st || !Array.isArray(st.combatants)) throw new Error('Missing combatants');
    if (st.combatants.length > 200) throw new Error('Too many combatants');
    const seen = new Set(), taken = new Set(), combatants = [];
    for (const raw of st.combatants) {
      const c = normalizeCombatant(raw, d.settings || {});
      if (seen.has(c.id)) { c.id = uid(); warnings.push(`Duplicate id for ${c.name} replaced`); }
      seen.add(c.id); c.x = Math.min(cols - 1, c.x); c.y = Math.min(rows - 1, c.y);
      if (taken.has(`${c.x},${c.y}`)) { // move to the nearest free tile
        let placed = false; for (let k = 0; k < cols * rows && !placed; k++) { const x = k % cols, y = Math.floor(k / cols); if (!taken.has(`${x},${y}`)) { c.x = x; c.y = y; placed = true; } }
        warnings.push(`${c.name} shared a tile and was moved`);
      }
      taken.add(`${c.x},${c.y}`); combatants.push(c);
    }
    const surfaces = {}; let dropped = 0;
    for (const [k, v] of Object.entries(d.surfaces && typeof d.surfaces === 'object' ? d.surfaces : {})) {
      const m = /^(\d+),(\d+)$/.exec(k);
      if (m && +m[1] < cols && +m[2] < rows && validSurfaces.includes(v)) surfaces[k] = v; else dropped++;
    }
    if (dropped) warnings.push(`${dropped} invalid surface tile(s) dropped`);
    const round = Number.isInteger(Number(st.round)) && Number(st.round) >= 1 ? Number(st.round) : 1;
    const s = d.settings || {}, num0 = (v, dflt) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : dflt;
    return {
      name: String(d.name || 'Imported encounter').slice(0, 80), cols, rows, surfaces,
      state: { round, activeId: combatants.some(c => c.id === st.activeId) ? st.activeId : null, combatants },
      log: (Array.isArray(d.log) ? d.log : []).slice(-500).map(String),
      settings: { apPerTurn: num0(s.apPerTurn, CONFIG.apPerTurn), maxAP: num0(s.maxAP, CONFIG.maxAP), autoSurfaces: s.autoSurfaces !== false },
      dm: d.dm && typeof d.dm === 'object' && !Array.isArray(d.dm) ? d.dm : null, warnings
    };
  }

  return { CONFIG, ARMOUR, STATUS, mulberry32, vitalityBoost, levelScaledDamage, healScaling, npcVitality, npcArmour, npcAttribute, npcAbility,
    calcSkill, damageRange, attackerOf, applyDamage, applyDirect, heal, applyStatus, removeStatuses, cleanseBy, setGear, statusResist, totalResist, rf,
    sortInitiative, spendAP, nextTurn, useSkill, resolveSurface, normalizeCombatant, buildEnemy, createHistory, serializeSave, loadSave, uid };
});
