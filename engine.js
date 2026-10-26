/* DOS2-inspired combat engine. Pure functions: no DOM, no hidden state, injectable RNG.
   Every constant below is labelled V (verified in a cited source), P (provisional) or T (tabletop adaptation). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DOS2 = factory();
})(this, function () {
  const CONFIG = {
    attrBase: 10,          // P: attribute value that gives 0% bonus (Formulas.md AttributeBaseValue = 10 is V; the +5%/point rate is P)
    attrPct: 5,            // P: % damage per attribute point above base
    abilityPct: 5,         // P: % damage per ability rank
    critPct: 50,           // P: bonus applied only on a critical hit
    levelRange: 0.05,      // P: level-scaled skills roll within +/-5% of levelScaledDamage (matches prototype table)
    overflowToVitality: true, // T: your rule: damage beyond armour spills into Vitality (50 MA + 100 magic = 50 to Vitality)
    apPerTurn: 4,          // T: AP gained at turn start
    maxAP: 6               // T: AP cap
  };
  // T: two damage categories. Physical -> Physical Armour; Magic (any elemental subtype kept for resistances/surfaces) -> Magic Armour.
  const ARMOUR = { Physical: 'pa', Magic: 'ma', Fire: 'ma', Water: 'ma', Air: 'ma', Earth: 'ma', Poison: 'ma' };
  const rf = x => Math.floor(x + 0.5);
  const num = (v, name) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${name} must be a finite number`); return v; };

  function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // V: Formulas.md (Norbyte, DE) "Skill Heal Scaling" / "Vitality Scaling"
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
    let lo, hi;
    if (skill.kind === 'weapon') { lo = num(atk.weaponMin, 'weaponMin') * mult; hi = num(atk.weaponMax, 'weaponMax') * mult; }
    else if (skill.kind === 'shield') { lo = hi = num(atk.shieldPA, 'shieldPA') * mult; }
    else if (skill.kind === 'level') { const b = levelScaledDamage(lvl); lo = b * (1 - c.levelRange) * mult; hi = b * (1 + c.levelRange) * mult; }
    else throw new Error('Unknown skill kind ' + skill.kind);
    if (hi < lo) throw new Error('weaponMax < weaponMin');
    const statName = skill.attr === 'weapon' ? (skill.type === 'Physical' ? ((st.STR || 0) >= (st.FIN || 0) ? 'STR' : 'FIN') : 'INT') : skill.attr;
    const attr = skill.attr === 'none' ? 0 : Math.max(0, (st[statName] ?? c.attrBase) - c.attrBase) * c.attrPct;
    const abil = (ab[skill.ability] || 0) * c.abilityPct;
    const critPct = o.crit ? c.critPct : 0;
    const weaponLike = skill.kind === 'weapon' || skill.kind === 'shield';
    // Order per Fextralife "Damage": weapon = (1+elem)(1+attr+skill+misc)(1+hg+crit); spell = (1+elem)(1+attr)(1+misc)(1+hg+crit).
    // Where the school ability sits for spells is unconfirmed: kept with attribute as in the prototype (P).
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
  function heal(t, amount) { const n = { ...t }, h = Math.max(0, Math.min(n.maxVitality - n.vitality, amount)); n.vitality += h; if (n.vitality > 0) n.defeated = false; return { target: n, healed: h }; }

  // T: higher initiative first; tie -> players before enemies; tie -> id (deterministic).
  const sortInitiative = list => [...list].sort((a, b) => (b.initiative - a.initiative) || (a.type === b.type ? 0 : a.type === 'player' ? -1 : 1) || (a.id < b.id ? -1 : 1));

  function spendAP(x, cost, override = false) {
    num(cost, 'cost');
    if (!override && x.ap < cost) return { ok: false, reason: `needs ${cost} AP, has ${x.ap}`, combatant: x };
    return { ok: true, combatant: { ...x, ap: Math.max(0, x.ap - cost) } };
  }

  // The ONLY place AP is granted. Skips defeated and skipNext combatants (no AP for them). state: {round, activeId, combatants[]}
  function nextTurn(s, cfg = {}) {
    const c = { ...CONFIG, ...cfg }, list = s.combatants.map(x => ({ ...x })), events = [];
    if (!list.some(x => !x.defeated)) return { state: { ...s, combatants: list }, events: [{ t: 'no-active' }] };
    let i = list.findIndex(x => x.id === s.activeId), round = s.round;
    for (let g = 0; g < list.length * 2 + 2; g++) {
      i++; if (i >= list.length) { i = 0; round++; }
      const x = list[i];
      if (x.defeated) continue;
      if (x.skipNext) { x.skipNext = false; events.push({ t: 'skipped', id: x.id }); continue; }
      const before = x.ap; if (x.ap < c.maxAP) x.ap = Math.min(c.maxAP, x.ap + (x.apPerTurn ?? c.apPerTurn));
      events.push({ t: 'turn', id: x.id, round, apGained: x.ap - before });
      return { state: { ...s, round, activeId: x.id, combatants: list }, events };
    }
    return { state: { ...s, combatants: list }, events: [{ t: 'no-active' }] };
  }

  return { CONFIG, ARMOUR, mulberry32, levelScaledDamage, healScaling, calcSkill, damageRange, applyDamage, heal, sortInitiative, spendAP, nextTurn };
});
