/* Game data, kept separate from engine and UI. Edit this file to add skills, enemies or surfaces.
   verified: 'sourced' = AP, cooldown, multiplier and effects copied from the cited page (community guide, DE);
             the damage formula applied to them is still partly provisional (see AUDIT.md).
   Skill sources: GS = GameFAQs DOS2 skills guide https://gamefaqs.gamespot.com/ps5/603846-divinity-original-sin-ii/faqs/81674/skills
                  DW = https://dos2.wiki/wiki/Fossil_Strike */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DOS2DATA = factory();
})(this, function () {
  const W = (id, name, ap, cooldown, mult, extra = {}) => ({ id, name, school: 'Warfare', kind: 'weapon', type: 'Physical', attr: 'weapon', ability: 'warfare', ap, cooldown, mult, verified: 'sourced', source: 'GS', ...extra });
  const F = (id, name, ap, cooldown, mult, extra = {}) => ({ id, name, school: 'Pyrokinetic', kind: 'level', type: 'Fire', attr: 'INT', ability: 'pyrokinetic', ap, cooldown, mult, verified: 'sourced', source: 'GS', ...extra });

  const SKILLS = [
    W('battering-ram', 'Battering Ram', 2, 5, 0.5, { statuses: [{ id: 'knockedDown' }], notes: 'Hits enemies in its path. Knockdown only if Physical Armour is 0.' }),
    W('battle-stomp', 'Battle Stomp', 2, 4, 0.9, { statuses: [{ id: 'knockedDown' }], notes: 'Enemies in front. Surface clearing not simulated.' }),
    W('bouncing-shield', 'Bouncing Shield', 2, 2, 1.6, { kind: 'shield', attr: 'none', maxTargets: 2, notes: '160% of the shield\'s Physical Armour; bounces to a second enemy within 5 m.' }),
    W('crippling-blow', 'Crippling Blow', 2, 3, 1.15, { statuses: [{ id: 'crippled' }], notes: 'Target and adjacent enemies (choose them all).' }),
    W('whirlwind', 'Whirlwind', 2, 3, 1.0, { notes: 'All surrounding enemies (choose them all).' }),
    W('blitz-attack', 'Blitz Attack', 2, 3, 0.7, { maxTargets: 2, notes: '2 random enemies within 10 m; choose up to 2.' }),
    W('onslaught', 'Onslaught', 4, 6, 0.5, { hits: 5, notes: '5 hits. Source Point cost (2) is not tracked.' }),
    W('overpower', 'Overpower', 2, 1, 1.5, { statuses: [{ id: 'knockedDown' }], notes: 'The Physical Armour-destroying part is not simulated.' }),
    { id: 'haste', name: 'Haste', school: 'Pyrokinetic', kind: 'utility', type: 'Magic', ap: 1, cooldown: 3, statuses: [{ id: 'hasted' }], verified: 'sourced', source: 'GS', notes: 'Target an ally. Clears Crippled and Slowed.' },
    F('searing-daggers', 'Searing Daggers', 2, 3, 0.25, { hits: 3, statuses: [{ id: 'burning' }], notes: '3 daggers at 25% each, modelled on one target.' }),
    F('fireball', 'Fireball', 2, 4, 1.0, { statuses: [{ id: 'burning' }], notes: '3 m radius: choose every target in the area.' }),
    F('supernova', 'Supernova', 3, 6, 1.75, { statuses: [{ id: 'burning' }], notes: '4 m radius.' }),
    F('laser-ray', 'Laser Ray', 3, 3, 1.5, { statuses: [{ id: 'burning' }], notes: 'Line. Fire clouds not simulated.' }),
    F('fire-whip', 'Fire Whip', 3, 3, 1.2, { statuses: [{ id: 'burning', duration: 1 }], notes: 'Blinded not modelled.' }),
    { id: 'cleanse-wounds', name: 'Cleanse Wounds', school: 'Hydrosophist', kind: 'heal', type: 'Heal', ap: 2, cooldown: 3, healValue: 100, cures: ['burning', 'poisoned', 'bleeding'], verified: 'provisional', source: 'FW',
      notes: 'AP 2 and "heals target, removes Burning/Poisoned/Bleeding" per the OS2 wiki Warfare page (craftable list). Heal value 100 and cooldown 3 are P. The water puddle is not created (use the surface brush).' },
    { id: 'deflective-barrier', name: 'Deflective Barrier', school: 'Warfare', kind: 'restore', type: 'Physical', pool: 'pa', pct: 50, ap: 2, cooldown: 4, verified: 'provisional', source: 'FW',
      notes: 'AP 2 and "grants Physical Armour" per the OS2 wiki Warfare page; the amount is not published, so 50% of max PA and cooldown 4 are P. Projectile reflection is not simulated.' },
    { id: 'fossil-strike', name: 'Fossil Strike', school: 'Geomancer', kind: 'level', type: 'Earth', attr: 'INT', ability: 'geomancer', ap: 2, cooldown: 3, multRange: [0.8, 0.9], verified: 'sourced', source: 'DW',
      notes: '13 m range, 2 m radius. Oil surface and 2-turn Slow are not simulated (use the surface brush). "80-90%" read as a damage range: P.' }
  ];

  // Enemy archetypes (original names). vit/pa/ma are % of the level-scaled value (Formulas.md); attrs use the level-mapped attribute formula.
  const ENEMIES = [
    { id: 'brute', name: 'Raider Brute', vit: 110, pa: 140, ma: 20, attrs: { STR: 60, FIN: 20, INT: 10 }, abilities: { warfare: 8 }, skills: ['battering-ram', 'battle-stomp', 'crippling-blow'], initiative: 8 },
    { id: 'pyromancer', name: 'Cultist Pyromancer', vit: 80, pa: 20, ma: 140, attrs: { STR: 10, FIN: 20, INT: 60 }, abilities: { pyrokinetic: 8 }, skills: ['fireball', 'searing-daggers', 'haste'], initiative: 12 },
    { id: 'skirmisher', name: 'Skirmisher', vit: 90, pa: 80, ma: 60, attrs: { STR: 30, FIN: 50, INT: 10 }, abilities: { warfare: 6 }, skills: ['blitz-attack', 'whirlwind'], initiative: 14 },
    { id: 'warden', name: 'Stone Warden', vit: 150, pa: 200, ma: 100, attrs: { STR: 50, FIN: 10, INT: 30 }, abilities: { warfare: 7, geomancer: 6 }, skills: ['bouncing-shield', 'overpower', 'fossil-strike'], shield: 100, initiative: 6 }
  ];

  ENEMIES.push(
    { id: 'healer', name: 'Temple Cleric', vit: 90, pa: 40, ma: 110, attrs: { STR: 10, FIN: 20, INT: 50 }, abilities: { pyrokinetic: 4 }, skills: ['cleanse-wounds', 'haste', 'fireball'], initiative: 11, loot: 'humanoid' },
    { id: 'guard', name: 'Barricade Guard', vit: 130, pa: 170, ma: 40, attrs: { STR: 50, FIN: 20, INT: 10 }, abilities: { warfare: 6 }, skills: ['deflective-barrier', 'crippling-blow', 'whirlwind'], shield: 80, initiative: 7, loot: 'soldier' }
  );
  ENEMIES.forEach(e => { if (!e.loot) e.loot = e.id === 'warden' ? 'boss' : e.id === 'pyromancer' ? 'humanoid' : 'soldier'; });

  // Tabletop adaptation (T), per your rules: ordinary hazards flat, cursed scales with level, blessed heals by level. All configurable.
  const SURFACES = {
    fire: { label: 'Fire', type: 'Fire', flat: 12, status: 'burning' },
    poison: { label: 'Poison', type: 'Poison', flat: 10, status: 'poisoned' },
    water: { label: 'Water', status: 'wet' },
    oil: { label: 'Oil' },
    electric: { label: 'Electrified Water', type: 'Air', flat: 14, status: 'shocked' },
    'cursed-fire': { label: 'Cursed Fire', type: 'Fire', base: 8, perLevel: 12, status: 'burning' },
    blessed: { label: 'Blessed Surface', heal: { perLevel: 10, min: 1 } }
  };

  // Surface interaction matrix, keyed 'existing+incoming'. null result = surface removed. All entries are P/T: behaviour follows DOS2 as I know it,
  // but no fetched source confirmed the table. Anything not listed simply replaces the old surface.
  const INTERACTIONS = {
    'oil+fire': ['fire', 'The oil ignites.'], 'fire+oil': ['fire', 'The oil ignites.'],
    'poison+fire': ['fire', 'The poison burns off (explosion not simulated).'], 'fire+poison': ['fire', 'The poison burns off (explosion not simulated).'],
    'water+fire': [null, 'The fire is put out (steam not simulated).'], 'fire+water': [null, 'The fire is put out (steam not simulated).'],
    'water+electric': ['electric', 'The water is electrified.'], 'electric+water': ['electric', 'The water stays electrified.'],
    'oil+cursed-fire': ['cursed-fire', 'The oil ignites with cursed fire.'], 'poison+cursed-fire': ['cursed-fire', 'The poison burns with cursed fire.'],
    'water+cursed-fire': ['cursed-fire', 'Water cannot douse cursed fire (T).'], 'cursed-fire+water': ['cursed-fire', 'Water cannot douse cursed fire (T).'],
    'cursed-fire+blessed': ['fire', 'The blessing cleanses the curse; ordinary fire remains.'], 'blessed+cursed-fire': ['fire', 'The blessing cleanses the curse; ordinary fire remains.']
  };

  // Skill geometry (P unless the skill's own notes cite a figure). 1 tile = 1 m. shape: single | radius (around the aimed tile) | around (the actor) | line | pick (nearest N).
  // range 'weapon' = the equipped weapon's reach. friendlyFire: area hits allies too (DOS2-like for elemental AoE).
  const GEOM = {
    'battering-ram': { shape: 'line', size: 6, targets: 'enemy' }, 'battle-stomp': { shape: 'line', size: 3, targets: 'enemy' },
    'bouncing-shield': { shape: 'pick', range: 8, targets: 'enemy' }, 'crippling-blow': { shape: 'radius', size: 1.5, range: 'weapon', targets: 'enemy' },
    'whirlwind': { shape: 'around', size: 1.5, targets: 'enemy' }, 'blitz-attack': { shape: 'pick', range: 10, targets: 'enemy', cited: true },
    'onslaught': { shape: 'single', range: 'weapon', targets: 'enemy' }, 'overpower': { shape: 'single', range: 'weapon', targets: 'enemy' },
    'haste': { shape: 'single', range: 13, targets: 'ally' }, 'searing-daggers': { shape: 'single', range: 13, targets: 'enemy' },
    'fireball': { shape: 'radius', size: 3, range: 13, targets: 'enemy', friendlyFire: true, cited: true }, 'supernova': { shape: 'radius', size: 4, range: 13, targets: 'enemy', friendlyFire: true, cited: true },
    'laser-ray': { shape: 'line', size: 10, targets: 'enemy' }, 'fire-whip': { shape: 'single', range: 5, targets: 'enemy' },
    'fossil-strike': { shape: 'radius', size: 2, range: 13, targets: 'enemy', friendlyFire: true, cited: true },
    'cleanse-wounds': { shape: 'single', range: 8, targets: 'ally' }, 'deflective-barrier': { shape: 'single', range: 0, targets: 'self' }
  };

  // Equipment. Gear scales with the wearer's level (T): weapon damage = share of levelScaledDamage; armour values use the same level scaling as enemy templates.
  const ITEMS = {
    'iron-sword': { name: 'Iron Sword', slot: 'weapon', dmg: [0.9, 1.1], range: 1.5, attr: 'STR' },
    'war-axe': { name: 'War Axe', slot: 'weapon', dmg: [1.1, 1.4], range: 1.5, attr: 'STR', twoHanded: true },
    'dagger': { name: 'Steel Dagger', slot: 'weapon', dmg: [0.7, 0.9], range: 1.5, attr: 'FIN', attrs: { FIN: 1 } },
    'recurve-bow': { name: 'Recurve Bow', slot: 'weapon', dmg: [0.85, 1.05], range: 8, attr: 'FIN', twoHanded: true },
    'ash-staff': { name: 'Ash Staff', slot: 'weapon', dmg: [0.8, 1.0], range: 6, attr: 'INT', attrs: { INT: 2 }, twoHanded: true },
    'round-shield': { name: 'Round Shield', slot: 'shield', paPct: 60 },
    'tower-shield': { name: 'Tower Shield', slot: 'shield', paPct: 110, attrs: { FIN: -1 } },
    'leather-vest': { name: 'Leather Vest', slot: 'armour', paPct: 50, maPct: 30 },
    'plate-cuirass': { name: 'Plate Cuirass', slot: 'armour', paPct: 120, maPct: 20, attrs: { FIN: -1 } },
    'scholar-robe': { name: "Scholar's Robe", slot: 'armour', paPct: 20, maPct: 110, attrs: { INT: 1 } },
    'ember-ring': { name: 'Ember Ring', slot: 'accessory', resist: { Fire: 20 } },
    'frost-charm': { name: 'Frost Charm', slot: 'accessory', resist: { Water: 20 } },
    'ward-amulet': { name: 'Ward Amulet', slot: 'accessory', resist: { Poison: 20, Earth: 10 } },
    'vital-band': { name: 'Band of Vitality', slot: 'accessory', vitPct: 25 }
  };
  const LOOT = {
    humanoid: { gold: [4, 9], drops: [{ item: 'scholar-robe', chance: 0.15 }, { item: 'ember-ring', chance: 0.2 }, { item: 'ash-staff', chance: 0.15 }] },
    soldier: { gold: [5, 12], drops: [{ item: 'iron-sword', chance: 0.25 }, { item: 'round-shield', chance: 0.2 }, { item: 'leather-vest', chance: 0.2 }, { item: 'dagger', chance: 0.1 }] },
    boss: { gold: [25, 40], drops: [{ item: 'tower-shield', chance: 0.6 }, { item: 'plate-cuirass', chance: 0.5 }, { item: 'war-axe', chance: 0.5 }, { item: 'vital-band', chance: 0.4 }] }
  };
  // XP needed to reach each level: copied from the Fextralife DOS2 "Experience" page (fetched). Level 35 is the last row on that page.
  const XP_TABLE = [0, 0, 2000, 8000, 20000, 40000, 70000, 112000, 168000, 240000, 340000, 479000, 672000, 941000, 1315000, 1834000, 2556000, 3559000, 4954000, 6893000, 9588000, 13334000, 18540000, 25777000, 35836000, 49818000, 69253000, 96268000, 133818000, 186013000, 258564000, 359410000, 499586000, 694430000, 965264000, 1341723000];
  // Tabletop progression settings. The wiki page does not state points per level, so these are P and configurable.
  const PROGRESSION = { maxLevel: 21, killXpDivisor: 8, attrPointsPerLevel: 2, combatPointsPerLevel: 1, abilityCap: 10 };

  return { SKILLS, ENEMIES, SURFACES, INTERACTIONS, GEOM, ITEMS, LOOT, XP_TABLE, PROGRESSION };
});
