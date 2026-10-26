const E = DOS2, D = DOS2DATA, W = DOS2WORLD, $ = id => document.getElementById(id), SURF_KEYS = Object.keys(D.SURFACES);
const SURF_ICON = { fire: '🔥', poison: '☠', water: '💧', oil: '◒', electric: 'ϟ', 'cursed-fire': '♜', blessed: '✦' };
const KEY = 'dos2-battleboard-autosave-v2';
let rows = 10, cols = 14, surfaces = {}, state = { round: 1, activeId: null, combatants: [] }, settings = { apPerTurn: 4, maxAP: 6, autoSurfaces: true }, logLines = [], dm = W.emptyDm(), dmView = true, tilePx = 48, aim = null, plan = null, lastPlanKey = '';
const openSec = new Set(), LIB_KEY = 'dos2-battleboard-library-v1';
let selectedId = null, selectedTile = null, tool = 'select', armedMoveId = null, dragId = null, selSkillId = null, targets = new Set(), rollLock = false, lastBreakdown = null;
const history = E.createHistory(100);

const h = (tag, props = {}, ...kids) => { const el = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') el.className = v; else if (k.startsWith('on')) el[k] = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); } for (const kid of kids.flat()) if (kid != null) el.append(kid); return el; };
const say = s => { $('statusText').textContent = s; };
const cfg = () => ({ apPerTurn: settings.apPerTurn, maxAP: settings.maxAP });
const byId = id => state.combatants.find(c => c.id === id);
const tileKey = (x, y) => `${x},${y}`;
const occupant = (x, y) => state.combatants.find(c => c.x === x && c.y === y);
function log(s) { logLines.unshift(`R${state.round} · ${s}`); if (logLines.length > 500) logLines.length = 500; }
const logEvents = evs => evs.forEach(e => log(e.text));

// ---- history / persistence ----
const snap = () => JSON.parse(JSON.stringify({ rows, cols, surfaces, state, settings, log: logLines, dm }));
function restore(s) { rows = s.rows; cols = s.cols; surfaces = s.surfaces; state = s.state; settings = s.settings; logLines = s.log; dm = s.dm || W.emptyDm(); aim = null; $('autoSurf').checked = settings.autoSurfaces !== false; $('rows').value = rows; $('cols').value = cols; $('setApTurn').value = settings.apPerTurn; $('setMaxAp').value = settings.maxAP; if (!byId(selectedId)) selectedId = null; targets = new Set([...targets].filter(byId)); armedMoveId = null; renderAll(); }
function collect() { const r = W.collectRewards(state, dm, Math.random); if (r.events.length) { state = r.state; dm = r.dm; logEvents(r.events); } }
function commit(fn) { history.push(snap()); fn(); collect(); renderAll(); }
function surfaceTrigger(id, trig) { const r = W.triggerSurface(state, surfaces, id, trig); state = r.state; logEvents(r.events); }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(E.serializeSave(currentSave()))); } catch (e) { say('Autosave failed (browser storage full?). Use Export encounter to back up.'); } }
const currentSave = () => ({ name: $('encName').value, cols, rows, surfaces, log: logLines.slice().reverse(), settings, state, dm });
function applyLoaded(d) { rows = d.rows; cols = d.cols; surfaces = d.surfaces; state = d.state; settings = d.settings; logLines = d.log.slice().reverse(); dm = W.normalizeDm(d.dm); aim = null; $('autoSurf').checked = settings.autoSurfaces !== false; $('encName').value = d.name; $('rows').value = rows; $('cols').value = cols; $('setApTurn').value = settings.apPerTurn; $('setMaxAp').value = settings.maxAP; selectedId = state.combatants[0]?.id ?? null; targets = new Set(); armedMoveId = null; }

// ---- helpers ----
function resort() { state.combatants = E.sortInitiative(state.combatants); }
function freeTile(pref) { const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !occupant(x, y); if (pref && free(pref.x, pref.y)) return pref; for (let k = 0; k < cols * rows; k++) { const x = k % cols, y = Math.floor(k / cols); if (free(x, y)) return { x, y }; } return { x: 0, y: 0 }; }
function shrink(file) { return new Promise(res => { const r = new FileReader(); r.onload = () => { const img = new Image(); img.onload = () => { const s = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = 96; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96); res(c.toDataURL('image/jpeg', 0.8)); }; img.onerror = () => res(''); img.src = r.result; }; r.onerror = () => res(''); r.readAsDataURL(file); }); }
function weaponFor(level) { const l = E.levelScaledDamage(level); return { min: Math.round(l * 0.9), max: Math.round(l * 1.1) }; }

function addCombatant(portrait) {
  const type = $('newType').value, level = Math.max(1, Math.min(21, Number($('newLevel').value) || 1));
  const pos = freeTile(type === 'player' ? { x: 1, y: Math.floor(rows / 2) } : { x: cols - 2, y: Math.floor(rows / 2) });
  const name = $('newName').value.trim() || `${type === 'player' ? 'Player' : 'Enemy'} ${state.combatants.length + 1}`;
  const v = Math.max(1, Number($('newVit').value) || 100), pa = Math.max(0, Number($('newPA').value) || 0), ma = Math.max(0, Number($('newMA').value) || 0);
  commit(() => {
    const c = E.normalizeCombatant({ name, type, level, ...pos, maxVitality: v, maxPA: pa, maxMA: ma, ap: settings.apPerTurn, maxAP: settings.maxAP, apPerTurn: settings.apPerTurn, weapon: weaponFor(level), portrait: portrait || '', skills: D.SKILLS.map(s => s.id) }, cfg());
    state.combatants.push(c); resort(); selectedId = c.id; log(`${name} added at (${c.x + 1}, ${c.y + 1}).`);
  });
  $('newName').value = ''; $('newPortrait').value = '';
}
function addTplUnit(tpl, level) {
  const n = state.combatants.filter(c => c.name.startsWith(tpl.name)).length;
  const c = E.buildEnemy({ ...tpl, apPerTurn: settings.apPerTurn }, level, E.uid()); c.name = n ? `${tpl.name} ${n + 1}` : tpl.name; c.maxAP = settings.maxAP; c.ap = Math.min(c.ap, c.maxAP); c.loot = tpl.loot || '';
  Object.assign(c, freeTile({ x: cols - 2, y: Math.floor(rows / 2) })); state.combatants.push(W.recalc(c)); resort(); selectedId = c.id; log(`${c.name} (level ${level}) added at (${c.x + 1}, ${c.y + 1}).`);
}
function addTemplate(count = 1) {
  const tpl = D.ENEMIES.find(t => t.id === $('tplSelect').value), level = Math.max(1, Math.min(21, Number($('tplLevel').value) || 1)); if (!tpl) return;
  commit(() => { for (let k = 0; k < count; k++) addTplUnit(tpl, level); });
}
function moveCombatant(id, x, y) {
  const c = byId(id); if (!c || x < 0 || y < 0 || x >= cols || y >= rows) return;
  const o = occupant(x, y); if (o && o.id !== id) { say(`${o.name} occupies that tile.`); return; }
  commit(() => { const old = `(${c.x + 1}, ${c.y + 1})`; c.x = x; c.y = y; selectedId = id; selectedTile = { x, y }; log(`${c.name} moved ${old} → (${x + 1}, ${y + 1}).`); if (settings.autoSurfaces) surfaceTrigger(id, 'enter'); });
}
function setC(id, fn) { const i = state.combatants.findIndex(c => c.id === id); if (i < 0) return; commit(() => { const c = JSON.parse(JSON.stringify(state.combatants[i])); fn(c); state.combatants[i] = W.recalc(E.normalizeCombatant(c, cfg())); resort(); }); }

// ---- turn control ----
function nextTurn() {
  if (!state.combatants.length) return say('Add combatants first.');
  commit(() => { const r = E.nextTurn(state, cfg()); state = r.state; logEvents(r.events); if (state.activeId) { selectedId = state.activeId; if (settings.autoSurfaces) surfaceTrigger(state.activeId, 'start'); } });
}
function resetEncounter() {
  if (!confirm('Reset the encounter? Round, AP, resources, statuses and cooldowns are restored and enemies can pay out rewards again. Positions, surfaces and rewards already waiting stay.')) return;
  commit(() => { state = { round: 1, activeId: null, combatants: state.combatants.map(c => ({ ...c, vitality: c.maxVitality, pa: c.maxPA, ma: c.maxMA, ap: 0, statuses: [], cooldowns: {}, defeated: false, skipNext: false, rewarded: false, surfStamp: '' })) }; log('Encounter reset.'); });
}

// ---- rendering ----
function bar(cls, label, cur, max, hideNums) { const b = h('div', { class: 'bar ' + cls }); const i = h('i'); i.style.width = `${max > 0 ? Math.max(0, Math.min(100, cur / max * 100)) : 0}%`; b.append(i, h('span', {}, hideNums ? label : `${label} ${cur}/${max}`)); return b; }
function portraitEl(c, cls) { if (c.portrait) { const im = h('img', { src: c.portrait, alt: c.name }); im.className = cls; return im; } return h('div', { class: cls }, c.name.split(/\s+/).map(a => a[0]).join('').slice(0, 2).toUpperCase()); }
function renderBoard() {
  const b = $('board'); b.innerHTML = ''; b.style.setProperty('--t', tilePx + 'px'); b.style.gridTemplateColumns = `repeat(${cols},${tilePx}px)`; b.style.gridTemplateRows = `repeat(${rows},${tilePx}px)`; const inArea = new Set((plan && plan.tiles ? plan.tiles : []).map(t => tileKey(t.x, t.y)));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const el = h('div', { class: 'tile' + (selectedTile && selectedTile.x === x && selectedTile.y === y ? ' sel' : '') + (inArea.has(tileKey(x, y)) ? ' area' : '') + (aim && aim.x === x && aim.y === y ? ' aim' : ''), title: `(${x + 1}, ${y + 1})${surfaces[tileKey(x, y)] ? ' · ' + D.SURFACES[surfaces[tileKey(x, y)]].label : ''}` });
    const sf = surfaces[tileKey(x, y)];
    if (sf) { el.append(h('div', { class: 'surface ' + sf }), h('span', { class: 'surface-icon' }, SURF_ICON[sf] || '')); }
    const c0 = occupant(x, y), c = c0 && W.visible(c0, dmView) ? c0 : null;
    if (c) {
      const tok = h('div', { class: `token ${c.type}${c.id === selectedId ? ' selected' : ''}${c.id === state.activeId ? ' active' : ''}${c.defeated ? ' defeated' : ''}${c.hidden ? ' hiddenunit' : ''}`, draggable: tool === 'select' ? 'true' : null, title: dmView || c.type === 'player' ? `${c.name} · VIT ${c.vitality}/${c.maxVitality}${c.hidden ? ' · hidden from players' : ''}` : c.name });
      if (c.portrait) tok.append(h('img', { src: c.portrait, alt: c.name })); else tok.append(h('span', {}, c.name.split(/\s+/).map(a => a[0]).join('').slice(0, 3).toUpperCase()));
      const hp = h('div', { class: 'hpbar' }), fill = h('i'); fill.style.width = `${Math.max(0, Math.min(100, c.vitality / c.maxVitality * 100))}%`; hp.append(fill); tok.append(hp, h('div', { class: 'token-label' }, c.name));
      tok.onclick = e => { e.stopPropagation(); if (tool === 'aim') { setAim(x, y); return; } if (tool !== 'select') return; selectedId = c.id; armedMoveId = c.id; renderAll(); say(`${c.name} selected. Click a tile to move it.`); };
      tok.ondragstart = e => { dragId = c.id; e.dataTransfer.setData('text/plain', c.id); };
      el.append(tok);
    }
    el.onclick = () => onTileClick(x, y);
    el.ondragover = e => { if (dragId) { e.preventDefault(); el.classList.add('dragover'); } };
    el.ondragleave = () => { el.classList.remove('dragover'); };
    el.ondrop = e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || dragId; dragId = null; moveCombatant(id, x, y); };
    b.append(el);
  }
}
function onTileClick(x, y) {
  const k = tileKey(x, y);
  if (tool === 'surface') { commit(() => { const r = W.placeSurface(surfaces, x, y, $('surfaceType').value); surfaces = r.surfaces; log(`${D.SURFACES[$('surfaceType').value].label} painted at (${x + 1}, ${y + 1}).${r.note ? ' ' + r.note : ''}`); }); return; }
  if (tool === 'aim') { setAim(x, y); return; }
  if (tool === 'erase') { if (surfaces[k]) commit(() => { delete surfaces[k]; log(`Surface erased at (${x + 1}, ${y + 1}).`); }); return; }
  if (armedMoveId) { const id = armedMoveId; armedMoveId = null; moveCombatant(id, x, y); return; }
  selectedTile = { x, y }; say(`Tile (${x + 1}, ${y + 1}) selected${surfaces[k] ? ' · ' + D.SURFACES[surfaces[k]].label : ''}.`); renderBoard();
}
function renderList() {
  const list = $('combatantList'); list.innerHTML = '';
  if (!state.combatants.length) list.append(h('div', { class: 'notice' }, 'No combatants yet.'));
  for (const c of state.combatants.filter(q => W.visible(q, dmView))) {
    const hn = !dmView && c.type === 'enemy';
    const info = h('div', { class: 'info' }, h('strong', {}, `${c.id === state.activeId ? '▶ ' : ''}${c.name}`), h('small', { class: 'muted' }, `${c.type} · Lv ${c.level} · Init ${c.initiative}${c.defeated ? ' · DEFEATED' : ''}${c.skipNext ? ' · skips next turn' : ''}${c.hidden ? ' · hidden' : ''}`),
      h('div', { class: 'bars' }, bar('vit', 'VIT', c.vitality, c.maxVitality, hn), bar('pa', 'PA', c.pa, c.maxPA, hn), bar('ma', 'MA', c.ma, c.maxMA, hn), bar('ap', 'AP', c.ap, c.maxAP, hn)));
    if (c.statuses.length) info.append(h('div', { class: 'chips' }, c.statuses.map(s => h('span', { class: 'chip' }, `${E.STATUS[s.id].name} ${s.turns}`))));
    const d = h('div', { class: `listitem${c.id === selectedId ? ' selected' : ''}${c.id === state.activeId ? ' active' : ''}${c.defeated ? ' defeated' : ''}` }, portraitEl(c, 'mini'), info);
    d.onclick = () => { selectedId = c.id; armedMoveId = null; renderAll(); };
    list.append(d);
  }
}
const nf = (label, val, min, onSet, max) => { const inp = h('input', { type: 'number', value: String(val), min: String(min) }); inp.onchange = () => { let v = Number(inp.value); if (!Number.isFinite(v)) v = val; v = Math.max(min, max != null ? Math.min(max, v) : v); onSet(v); }; return h('label', {}, label, inp); };
function renderSelected() {
  const p = $('selectedPanel'), c = byId(selectedId); p.innerHTML = '';
  if (!c) { p.append(h('div', { class: 'notice' }, 'Select a token or a name in the turn order.')); return; }
  const id = c.id, S = (key, fn) => v => setC(id, x => fn(x, v));
  const name = h('input', { type: 'text', value: c.name }); name.onchange = () => setC(id, x => { x.name = name.value.trim() || x.name; });
  p.append(h('label', {}, 'Name', name), h('div', { class: 'row' }, h('span', { class: 'pill' }, c.type.toUpperCase()), h('span', { class: 'pill' }, `Tile ${c.x + 1}, ${c.y + 1}`), c.defeated ? h('span', { class: 'pill warn' }, 'DEFEATED') : null));
  p.append(h('div', { class: 'sidegrid' },
    nf('Level', c.level, 1, S('level', (x, v) => { x.level = v; }), 21), nf('Initiative', c.initiative, -99, S('i', (x, v) => { x.initiative = v; })), h('label', {}, 'Random init', h('button', { onclick: () => setC(id, x => { x.initiative = 1 + Math.floor(Math.random() * 20); }) }, 'd20 (T)')),
    nf('Vitality', c.vitality, 0, S('v', (x, v) => { x.vitality = Math.min(v, x.maxVitality); x.defeated = x.vitality <= 0; })), nf('Max Vit.', c.maxVitality, 1, S('mv', (x, v) => { Object.assign(x, W.setMax(x, 'maxVitality', v)); })), h('span'),
    nf('Phys. Armour', c.pa, 0, S('pa', (x, v) => { x.pa = Math.min(v, x.maxPA); })), nf('Max PA', c.maxPA, 0, S('mpa', (x, v) => { Object.assign(x, W.setMax(x, 'maxPA', v)); })), h('span'),
    nf('Magic Armour', c.ma, 0, S('ma', (x, v) => { x.ma = Math.min(v, x.maxMA); })), nf('Max MA', c.maxMA, 0, S('mma', (x, v) => { Object.assign(x, W.setMax(x, 'maxMA', v)); })), h('span'),
    nf('AP', c.ap, 0, S('ap', (x, v) => { x.ap = Math.min(v, x.maxAP); })), nf('Max AP', c.maxAP, 0, S('map', (x, v) => { x.maxAP = v; })), nf('AP / turn', c.apPerTurn, 0, S('apt', (x, v) => { x.apPerTurn = v; }))));
  p.append(progressBlock(c), gearBlock(c));
  p.append(h('details', {}, h('summary', {}, 'Base attributes, abilities, weapon, resistances (gear adds on top)'), h('div', { class: 'stack details-content' },
    h('div', { class: 'sidegrid' }, ...['STR', 'FIN', 'INT'].map(k => nf(k, c.stats[k], 0, S(k, (x, v) => { x.stats[k] = v; })))),
    h('div', { class: 'sidegrid' }, ...['warfare', 'pyrokinetic', 'geomancer'].map(k => nf(k, c.abilities[k] || 0, 0, S(k, (x, v) => { x.abilities[k] = v; }), 10))),
    h('div', { class: 'sidegrid' }, nf('Weapon min', c.weapon.min, 0, S('wmin', (x, v) => { x.weapon.min = v; })), nf('Weapon max', c.weapon.max, 0, S('wmax', (x, v) => { x.weapon.max = v; })), nf('Shield PA', c.shieldPA, 0, S('sh', (x, v) => { x.shieldPA = v; }))),
    h('div', { class: 'notice' }, 'Resistance %: negative takes more damage, 100 is immune, above 100 heals.'),
    h('div', { class: 'sidegrid' }, ...['Physical', 'Fire', 'Water', 'Air', 'Earth', 'Poison'].map(k => nf(k, c.resistances[k] || 0, -200, S(k, (x, v) => { x.resistances[k] = v; }), 200))))));
  const known = h('div', { class: 'stack' }); D.SKILLS.forEach(s => { const cb = h('input', { type: 'checkbox', checked: c.skills.includes(s.id) }); cb.onchange = () => setC(id, x => { x.skills = cb.checked ? [...new Set([...x.skills, s.id])] : x.skills.filter(k => k !== s.id); }); known.append(h('label', { class: 'check' }, cb, `${s.name} (${s.school})`)); });
  p.append(h('details', {}, h('summary', {}, `Known skills (${c.skills.length})`), h('div', { class: 'skill-list' }, known)));
  const st = h('div', { class: 'stack' }), chips = h('div', { class: 'chips' });
  c.statuses.forEach(s => chips.append(h('span', { class: 'chip' }, `${E.STATUS[s.id].name} · ${s.turns}t`, h('button', { title: 'Remove', onclick: () => setC(id, x => { x.statuses = x.statuses.filter(q => q.id !== s.id); }) }, '×'))));
  const sel = h('select', {}, ...Object.entries(E.STATUS).map(([k, v]) => h('option', { value: k }, v.name)));
  const apply = h('button', { onclick: () => { commit(() => { const r = E.applyStatus(byId(id), sel.value, { ignoreGate: true }); state.combatants = state.combatants.map(q => q.id === id ? r.target : q); log(`GM applied ${E.STATUS[sel.value].name} to ${c.name}.`); }); } }, 'Apply (GM)');
  st.append(chips, h('div', { class: 'row' }, sel, apply)); p.append(h('div', {}, h('div', { class: 'muted tiny' }, 'Status effects'), st));
  p.append(dmBlock(c));
  p.append(h('div', { class: 'row' }, h('button', { onclick: () => commit(() => { const x = byId(id); x.vitality = Math.min(x.maxVitality, x.vitality + 20); x.defeated = x.vitality <= 0; log(`${x.name} healed 20 Vitality (GM).`); }) }, 'Heal +20'),
    h('button', { class: 'danger', onclick: () => commit(() => { state.combatants = state.combatants.filter(q => q.id !== id); if (state.activeId === id) state.activeId = null; selectedId = null; targets.delete(id); log(`${c.name} removed.`); }) }, 'Remove')));
}
function skillBlock(actor) {
  const sk = D.SKILLS.find(s => s.id === selSkillId); if (!sk) return null;
  const reasons = []; if (state.activeId && state.activeId !== actor.id) reasons.push('not their turn'); if (actor.ap < sk.ap) reasons.push(`needs ${sk.ap} AP`); if ((actor.cooldowns[sk.id] || 0) > 0) reasons.push(`cooldown ${actor.cooldowns[sk.id]}`); if (actor.defeated) reasons.push('defeated');
  return { sk, reasons };
}
function renderSkillPanel() {
  const p = $('skillPanel'); p.innerHTML = ''; const a = byId(selectedId);
  if (!a) { p.append(h('div', { class: 'notice' }, 'Select the acting combatant first.')); return; }
  const mine = D.SKILLS.filter(s => a.skills.includes(s.id));
  if (!mine.length) { p.append(h('div', { class: 'notice' }, `${a.name} knows no skills. Tick some under Known skills.`)); return; }
  if (!mine.some(s => s.id === selSkillId)) selSkillId = mine[0].id;
  const sel = h('select', {}); let g = null, og = null;
  mine.forEach(s => { if (s.school !== g) { g = s.school; og = h('optgroup', { label: g }); sel.append(og); } const cd = a.cooldowns[s.id] || 0; og.append(h('option', { value: s.id, selected: s.id === selSkillId }, `${s.name} · ${s.ap} AP${cd ? ` · CD ${cd}` : ''}`)); });
  sel.onchange = () => { selSkillId = sel.value; lastBreakdown = null; renderSkillPanel(); };
  const { sk, reasons } = skillBlock(a);
  p.append(h('label', {}, `${a.name}'s skill`, sel));
  p.append(h('div', { class: 'notice' }, `${sk.school} · ${sk.ap} AP · cooldown ${sk.cooldown} · ${['utility', 'restore'].includes(sk.kind) ? 'no damage' : sk.kind === 'heal' ? 'healing' : sk.type + ' damage'}${sk.hits ? ` · ${sk.hits} hits` : ''}${sk.maxTargets ? ` · up to ${sk.maxTargets} targets` : ''}. ${sk.notes || ''} `, h('span', { class: 'pill' }, `numbers: ${sk.verified}`)));
  if (reasons.length) p.append(h('div', { class: 'notice' }, h('span', { class: 'pill warn' }, 'Blocked: ' + reasons.join(', ') + ' (GM override can bypass)')));
  p.append(planLine(sk));
  const tl = h('div', { class: 'stack' }); state.combatants.filter(q => W.visible(q, dmView)).forEach(c => { const cb = h('input', { type: 'checkbox', checked: targets.has(c.id) }); cb.onchange = () => { cb.checked ? targets.add(c.id) : targets.delete(c.id); }; tl.append(h('label', { class: 'check' }, cb, `${c.name} (${c.type}${c.defeated ? ', defeated' : ''}) VIT ${c.vitality} PA ${c.pa} MA ${c.ma}`)); });
  p.append(h('div', {}, h('div', { class: 'muted tiny' }, 'Targets'), h('div', { class: 'target-list' }, tl)));
  p.append(h('div', { class: 'row' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'modCrit' }), 'Critical hit'), h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'gmOverride' }), 'GM override')));
  p.append(h('div', { class: 'sidegrid two' }, h('label', {}, 'High ground %', h('input', { type: 'number', id: 'modHG', value: '0' })), h('label', {}, 'Elemental gear %', h('input', { type: 'number', id: 'modGear', value: '0' })), h('label', {}, 'Weapon bonus %', h('input', { type: 'number', id: 'modWeapon', value: '0' })), h('label', {}, 'Misc %', h('input', { type: 'number', id: 'modMisc', value: '0' }))));
  p.append(h('div', { class: 'row' }, h('button', { onclick: previewSkill }, 'Preview min / avg / max'), h('button', { class: 'primary', id: 'rollBtn', onclick: rollSkill }, 'Roll & apply')));
  p.append(h('div', { id: 'breakdown', class: 'breakdown' }));
  if (lastBreakdown) drawBreakdown(lastBreakdown);
}
const n0 = id => Number($(id)?.value) || 0;
const modOpts = () => ({ crit: !!$('modCrit')?.checked, highGround: n0('modHG'), gear: n0('modGear'), weapon: n0('modWeapon'), misc: n0('modMisc') });
function previewSkill() {
  const a = byId(selectedId), sk = D.SKILLS.find(s => s.id === selSkillId), out = $('breakdown'); out.innerHTML = '';
  if (sk.kind === 'utility' || sk.kind === 'restore') { out.append(h('div', { class: 'res' }, sk.kind === 'restore' ? `Restores ${sk.pct}% of max ${sk.pool === 'ma' ? 'Magic' : 'Physical'} Armour (amount is provisional).` : 'No damage. Applies: ' + (sk.statuses || []).map(s => E.STATUS[s.id].name).join(', '))); return; }
  const ts = [...targets].map(byId).filter(Boolean); if (!ts.length) { say('Tick at least one target to preview resistances.'); ts.push({ name: '(no resistance)', resistances: {} }); }
  ts.forEach(t => { try { const r = E.damageRange(sk, E.attackerOf(W.gearView(a)), { ...modOpts(), resist: E.totalResist(t, sk.type) }); out.append(h('div', { class: 'res' }, h('b', {}, t.name), `: min ${r.min} · avg ${r.avg} · max ${r.max}`)); } catch (e) { out.append(h('div', { class: 'res' }, 'Cannot calculate: ' + e.message)); } });
}
function drawBreakdown(b) {
  const out = $('breakdown'); if (!out) return; out.innerHTML = '';
  b.results.forEach(r => {
    const box = h('div', { class: 'res' }, h('b', {}, r.name));
    if (r.calc && r.calc.kind === 'damage') {
      box.append(h('div', {}, `Base ${r.calc.base[0].toFixed(1)}–${r.calc.base[1].toFixed(1)} × ${r.calc.factors.map(f => `${f.name} ${f.value.toFixed(2)}`).join(' × ')} = ×${r.calc.multiplier.toFixed(3)}`));
      box.append(h('div', {}, 'Hits: ' + r.calc.hits.map(x => `roll ${x.roll.toFixed(1)} → ${x.amount}${x.amount !== x.afterResist ? ` → ${x.afterResist} after resistance` : ''}`).join('; ')));
      box.append(h('div', {}, `Total ${r.calc.total} ${r.calc.type}: armour absorbed ${r.absorbed}, Vitality lost ${r.vitality}${r.healed ? `, healed ${r.healed}` : ''}`));
    } else if (r.calc) box.append(h('div', {}, `Healed ${r.healed}`));
    if (r.restored) box.append(h('div', {}, `Armour restored ${r.restored}`));
    r.statuses.forEach(s => box.append(h('div', {}, `${E.STATUS[s.id].name}: ${s.applied ? 'applied' : 'resisted (' + s.reason + ')'}`)));
    out.append(box);
  });
}
let lockTimer = null;
function rollSkill() {
  if (rollLock) return; const a = byId(selectedId), sk = D.SKILLS.find(s => s.id === selSkillId); if (!a || !sk) return;
  const prob = castProblem(); if (prob && !$('gmOverride')?.checked) { say(prob + '. Tick GM override to cast anyway.'); return; }
  const r = E.useSkill(state, a.id, sk, [...targets], { ...modOpts(), override: !!$('gmOverride')?.checked }, Math.random, cfg());
  if (!r.ok) { say(r.reason + '.'); return; }
  rollLock = true; clearTimeout(lockTimer); lockTimer = setTimeout(() => { rollLock = false; }, 600); // guards against double clicks
  lastBreakdown = { results: r.results.map(x => ({ ...x, name: byId(x.targetId)?.name || '?' })) };
  commit(() => { state = r.state; logEvents(r.events); });
  say(`${sk.name} resolved.`);
}
// ---- targeting ----
function setAim(x, y) { aim = { x, y }; selectedTile = { x, y }; renderAll(); }
function updatePlan() {
  const a = byId(selectedId); plan = null; if (!a) return;
  const mine = D.SKILLS.filter(s => a.skills.includes(s.id)); if (!mine.length) return;
  if (!mine.some(s => s.id === selSkillId)) selSkillId = mine[0].id;
  const sk = D.SKILLS.find(s => s.id === selSkillId); plan = W.planCast(state, a.id, sk, aim, cols, rows);
  const k = [a.id, sk.id, aim ? aim.x + ',' + aim.y : '', state.combatants.map(c => c.id + c.x + c.y + (c.defeated ? 1 : 0)).join()].join('|');
  if (k !== lastPlanKey) { lastPlanKey = k; targets = new Set(plan.targetIds); }
}
function castProblem() {
  if (!plan) return 'Select an actor who knows a skill';
  if (!plan.ok) return plan.reason;
  const okIds = new Set(plan.candidateIds), bad = [...targets].map(byId).filter(c => c && !okIds.has(c.id));
  if (bad.length) return `${bad.map(c => c.name).join(', ')} outside the skill's area or range`;
  if (!targets.size) return 'No targets selected';
  return null;
}
function planLine(sk) {
  const a = byId(selectedId), g = W.geomFor(sk, a);
  const info = `${g.shape}${g.range ? ' · range ' + g.range : ''}${g.size ? ' · size ' + g.size : ''}${g.friendlyFire ? ' · hits allies too' : ''} (1 tile = 1 m; ${D.GEOM[sk.id]?.cited ? 'figures from the skill notes' : 'range and size provisional'})`;
  return h('div', { class: 'notice' }, plan && plan.ok ? h('b', {}, `Aim OK: ${plan.targetIds.length} in the area. `) : h('span', { class: 'pill warn' }, '⚠ ' + (plan ? plan.reason : 'no plan')), ' ', info, ' ', h('button', { onclick: () => setTool('aim') }, 'Aim on board'));
}
// ---- progression, gear, DM blocks ----
function det(title, key, ...kids) { const d = h('details', { class: 'dmd', open: openSec.has(key) }, h('summary', {}, title), h('div', { class: 'stack details-content' }, ...kids)); d.ontoggle = () => { d.open ? openSec.add(key) : openSec.delete(key); }; return d; }
function tryThen(check, apply) { try { check(); } catch (e) { say(e.message + '.'); return; } commit(apply); }
function replaceC(id, fn) { const i = state.combatants.findIndex(c => c.id === id); state.combatants[i] = fn(state.combatants[i]); }
function progressBlock(c) {
  const P = D.PROGRESSION, cur = Math.max(c.xp, W.xpFor(c.level)), base = W.xpFor(c.level), nextAt = c.level >= P.maxLevel ? null : W.xpFor(c.level + 1);
  const bar = h('div', { class: 'xpbar' }, h('i')); bar.firstChild.style.width = (nextAt ? Math.min(100, Math.max(0, (cur - base) / (nextAt - base) * 100)) : 100) + '%';
  const kids = [h('div', { class: 'muted tiny' }, `Level ${c.level} · XP ${cur}${nextAt ? ' / ' + nextAt : ' (max level)'}`), bar];
  if (c.points.attr || c.points.combat) {
    const row = h('div', { class: 'mini-row' }, h('span', { class: 'pill warn' }, `${c.points.attr} attribute · ${c.points.combat} combat points`));
    if (c.points.attr) ['STR', 'FIN', 'INT'].forEach(k => row.append(h('button', { onclick: () => tryThen(() => W.spendPoint(c, 'attr', k), () => { replaceC(c.id, x => W.spendPoint(x, 'attr', k)); log(`${c.name} raises ${k}.`); }) }, `+${k}`)));
    if (c.points.combat) ['warfare', 'pyrokinetic', 'geomancer'].forEach(k => row.append(h('button', { onclick: () => tryThen(() => W.spendPoint(c, 'combat', k), () => { replaceC(c.id, x => W.spendPoint(x, 'combat', k)); log(`${c.name} raises ${k}.`); }) }, `+${k}`)));
    kids.push(row);
  }
  const amt = h('input', { type: 'number', min: '0', value: '0', class: 'reward-amount' });
  kids.push(h('div', { class: 'mini-row' }, amt, h('button', { onclick: () => tryThen(() => W.grantXp(c, Number(amt.value)), () => { const r = W.grantXp(byId(c.id), Number(amt.value)); replaceC(c.id, () => r.c); log(`${c.name} gains ${Number(amt.value)} XP.`); logEvents(r.events); }) }, 'Give XP')));
  kids.push(h('div', { class: 'notice' }, `Level-ups grant ${P.attrPointsPerLevel} attribute and ${P.combatPointsPerLevel} combat point(s) (provisional). Maximums grow with the level-scaling formulas; current values rise by the same amount.`));
  return det('Level, XP & points', 'prog', ...kids);
}
function gearBlock(c) {
  const v = W.gearView(c), kids = [h('div', { class: 'notice' }, `Effective: weapon ${v.weapon.min}–${v.weapon.max}${v.shieldPA ? ' · shield ' + v.shieldPA + ' PA' : ''} · STR ${v.stats.STR} FIN ${v.stats.FIN} INT ${v.stats.INT}. Gear scales with the wearer's level (adaptation).`)];
  W.SLOTS.forEach(slot => {
    const eq = c.equipment[slot], carried = c.inventory.filter(i => D.ITEMS[i]?.slot === slot);
    const sel = h('select', {}, h('option', { value: '' }, carried.length ? 'Equip…' : '(none carried)'), ...carried.map(i => h('option', { value: i }, D.ITEMS[i].name)));
    sel.onchange = () => { if (sel.value) tryThen(() => W.equip(c, sel.value), () => { replaceC(c.id, x => W.equip(x, sel.value)); log(`${c.name} equips ${D.ITEMS[sel.value].name}.`); }); };
    kids.push(h('div', { class: 'mini-row' }, h('b', {}, slot), h('span', { class: 'item' }, eq ? D.ITEMS[eq].name : '—'), eq ? h('button', { onclick: () => commit(() => { replaceC(c.id, x => W.unequip(x, slot)); log(`${c.name} unequips ${D.ITEMS[eq].name}.`); }) }, 'Unequip') : null, sel));
  });
  const give = h('select', {}, ...Object.entries(D.ITEMS).map(([k, it]) => h('option', { value: k }, `${it.name} (${it.slot})`)));
  kids.push(h('div', { class: 'mini-row' }, give, h('button', { onclick: () => commit(() => { replaceC(c.id, x => ({ ...x, inventory: [...x.inventory, give.value] })); log(`${c.name} is given ${D.ITEMS[give.value].name}.`); }) }, 'Give item'),
    h('button', { onclick: () => commit(() => { replaceC(c.id, x => ['iron-sword', 'round-shield', 'leather-vest'].reduce((q, i) => W.equip({ ...q, inventory: [...q.inventory, i] }, i), x)); log(`${c.name} receives a starter kit.`); }) }, 'Starter kit')));
  kids.push(h('div', { class: 'muted tiny' }, `Carried: ${c.inventory.map(i => D.ITEMS[i]?.name || i).join(', ') || 'nothing'}`));
  return det('Equipment & inventory', 'gear', ...kids);
}
function dmBlock(c) {
  if (!dmView) return h('span');
  const hid = h('input', { type: 'checkbox', checked: c.hidden }); hid.onchange = () => setC(c.id, x => { x.hidden = hid.checked; });
  const notes = h('textarea', {}, c.notes); notes.onchange = () => setC(c.id, x => { x.notes = notes.value; });
  const kids = [h('label', { class: 'check' }, hid, 'Hidden from players (not drawn in Player view)'), h('label', {}, 'Private notes (DM only)', notes)];
  if (c.type === 'enemy') {
    const lt = h('select', {}, h('option', { value: '' }, '(no loot)'), ...Object.keys(D.LOOT).map(k => h('option', { value: k, selected: c.loot === k }, k))); lt.onchange = () => setC(c.id, x => { x.loot = lt.value; });
    const xr = h('input', { type: 'number', min: '0', value: c.xpReward ?? '', placeholder: 'auto' }); xr.onchange = () => setC(c.id, x => { x.xpReward = xr.value === '' ? null : Math.max(0, Number(xr.value) || 0); });
    kids.push(h('div', { class: 'sidegrid two' }, h('label', {}, 'Loot table', lt), h('label', {}, `XP reward (auto ${W.killXp(c.level)})`, xr)));
  }
  return det('DM: hidden, notes, rewards', 'dmblock', ...kids);
}
const readLib = () => { try { const l = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return Array.isArray(l) ? l.filter(x => x && x.name && x.data) : []; } catch (e) { return []; } };
const writeLib = l => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); return true; } catch (e) { say('Library save failed (browser storage full?). Use Export encounter.'); return false; } };
function renderDm() {
  const p = $('dmPanel'); p.innerHTML = ''; if (!dmView) return;
  p.append(h('h2', {}, 'DM tools')); const wrap = h('div', { class: 'section stack' }); p.append(wrap);
  // preparation
  const enc = h('textarea', { placeholder: 'Terrain, tactics, read-aloud text, secrets…' }, dm.encNotes); enc.onchange = () => commit(() => { dm.encNotes = enc.value; });
  const gsel = h('select', {}, ...D.ENEMIES.map(t => h('option', { value: t.id }, t.name))), gcount = h('input', { type: 'number', min: '1', max: '12', value: '2', class: 'group-count' }), glevel = h('input', { type: 'number', min: '1', max: '21', value: $('tplLevel').value, class: 'group-level' });
  const lib = readLib(), libList = h('div', { class: 'stack' });
  lib.forEach((e, i) => libList.append(h('div', { class: 'mini-row' }, h('span', { class: 'item' }, `${e.name} · ${String(e.saved || '').slice(0, 10)}`),
    h('button', { onclick: () => { try { const d = E.loadSave(e.data, SURF_KEYS); history.push(snap()); applyLoaded(d); log(`Loaded "${e.name}" from the library.`); renderAll(); } catch (err) { say('Could not load: ' + err.message); } } }, 'Load'),
    h('button', { class: 'danger', onclick: () => { const l = readLib(); l.splice(i, 1); writeLib(l); renderAll(); } }, 'Delete'))));
  wrap.append(det('Encounter preparation', 'prep', h('label', {}, 'Encounter notes (DM only)', enc),
    h('div', { class: 'mini-row' }, gsel, h('label', {}, 'x', gcount), h('label', {}, 'Lv', glevel), h('button', { onclick: () => { const tpl = D.ENEMIES.find(t => t.id === gsel.value), n = Math.max(1, Math.min(12, Number(gcount.value) || 1)), lv = Math.max(1, Math.min(21, Number(glevel.value) || 1)); commit(() => { for (let k = 0; k < n; k++) addTplUnit(tpl, lv); }); } }, 'Add group')),
    h('button', { onclick: () => commit(() => { state.combatants.forEach(c => { c.initiative = 1 + Math.floor(Math.random() * 20); }); resort(); log('Initiative rolled (d20) for everyone (adaptation).'); }) }, 'Roll initiative (d20) for all'),
    h('button', { onclick: () => { const l = readLib().filter(x => x.name !== $('encName').value); l.push({ name: $('encName').value || 'Untitled', saved: new Date().toISOString(), data: E.serializeSave(currentSave()) }); if (writeLib(l)) { say('Saved to the library.'); renderAll(); } } }, 'Save this encounter to the library'),
    h('div', { class: 'muted tiny' }, lib.length ? 'Library (this browser only; use Export for backups):' : 'Library is empty. Saved encounters live in this browser only.'), libList));
  // rewards
  const pxp = h('input', { type: 'number', min: '0', value: String(dm.pendingXp), class: 'pending-xp' }); pxp.onchange = () => commit(() => { dm.pendingXp = Math.max(0, Math.floor(Number(pxp.value) || 0)); });
  const gold = h('input', { type: 'number', min: '0', value: String(dm.gold), class: 'party-gold' }); gold.onchange = () => commit(() => { dm.gold = Math.max(0, Math.floor(Number(gold.value) || 0)); });
  const loot = h('div', { class: 'stack' });
  dm.pendingLoot.forEach((id, i) => loot.append(h('div', { class: 'mini-row' }, h('span', { class: 'item' }, `${D.ITEMS[id].name} (${D.ITEMS[id].slot})`), h('button', { disabled: !byId(selectedId), onclick: () => tryThen(() => { if (!byId(selectedId)) throw new Error('Select a recipient first'); }, () => { const r = W.awardLoot(state, dm, i, selectedId); state = r.state; dm = r.dm; logEvents(r.events); }) }, 'Give to selected'))));
  wrap.append(det('Rewards & loot', 'rewards', h('div', { class: 'notice' }, 'Defeated enemies add XP, gold and loot here once. Kill XP is 1/8 of the level-up cost (adaptation).'),
    h('div', { class: 'mini-row' }, h('label', {}, 'Pending XP', pxp), h('label', {}, 'Party gold', gold)),
    h('button', { class: 'primary', onclick: () => commit(() => { const r = W.distributeXp(state, dm); state = r.state; dm = r.dm; logEvents(r.events); }) }, 'Share XP between living players'),
    dm.pendingLoot.length ? loot : h('div', { class: 'muted tiny' }, 'No loot waiting.')));
  // NPCs and quests
  const npcs = h('div', { class: 'stack' });
  dm.npcs.forEach((n, i) => { const nn = h('input', { type: 'text', value: n.name }), nt = h('textarea', {}, n.notes); nn.onchange = () => commit(() => { dm.npcs[i].name = nn.value || 'Unnamed NPC'; }); nt.onchange = () => commit(() => { dm.npcs[i].notes = nt.value; });
    npcs.append(h('div', { class: 'item stack' }, nn, nt, h('button', { class: 'danger', onclick: () => commit(() => { dm.npcs.splice(i, 1); }) }, 'Delete'))); });
  wrap.append(det('NPC notes', 'npcs', npcs, h('button', { onclick: () => commit(() => { dm.npcs.push({ id: E.uid(), name: 'New NPC', notes: '' }); openSec.add('npcs'); }) }, 'Add NPC')));
  const quests = h('div', { class: 'stack' });
  dm.quests.forEach((q, i) => { const qt = h('input', { type: 'text', value: q.title }), qs = h('select', {}, ...['open', 'done', 'failed'].map(k => h('option', { value: k, selected: q.status === k }, k))), qn = h('textarea', {}, q.notes);
    qt.onchange = () => commit(() => { dm.quests[i].title = qt.value || 'Untitled quest'; }); qs.onchange = () => commit(() => { dm.quests[i].status = qs.value; }); qn.onchange = () => commit(() => { dm.quests[i].notes = qn.value; });
    quests.append(h('div', { class: 'item stack' }, qt, h('div', { class: 'mini-row' }, qs, h('button', { class: 'danger', onclick: () => commit(() => { dm.quests.splice(i, 1); }) }, 'Delete')), qn)); });
  wrap.append(det('Quest log', 'quests', quests, h('button', { onclick: () => commit(() => { dm.quests.push({ id: E.uid(), title: 'New quest', status: 'open', notes: '' }); openSec.add('quests'); }) }, 'Add quest')));
  const ses = h('textarea', { placeholder: 'Session notes, recap, hooks…', class: 'session-notes' }, dm.session); ses.onchange = () => commit(() => { dm.session = ses.value; });
  wrap.append(det('Session notes', 'session', ses));
}
function renderAll() {
  updatePlan(); renderBoard(); renderList(); renderSelected(); renderSkillPanel(); renderDm();
  const act = byId(state.activeId); $('turnLabel').textContent = `Round ${state.round} · ${act ? (W.visible(act, dmView) ? act.name : 'An unseen enemy') : 'No active turn'}`;
  $('combatLog').innerHTML = ''; if (dmView) logLines.slice(0, 200).forEach(l => $('combatLog').append(h('div', {}, l))); else $('combatLog').append(h('div', {}, 'The log is hidden in Player view.'));
  $('undoBtn').disabled = history.size() === 0; persist();
}

// ---- wiring ----
$('surfaceType').append(...SURF_KEYS.map(k => h('option', { value: k }, D.SURFACES[k].label)));
$('legend').append(...SURF_KEYS.map(k => { const i = h('i'); i.append(h('div', { class: 'surface surface-swatch ' + k })); return h('span', { class: 'sw' }, i, `${SURF_ICON[k]} ${D.SURFACES[k].label}`); }));
$('tplSelect').append(...D.ENEMIES.map(t => h('option', { value: t.id }, t.name)));
$('addCombatant').onclick = async () => { const f = $('newPortrait').files[0]; addCombatant(f ? await shrink(f) : ''); };

$('nextTurn').onclick = nextTurn; $('resetEnc').onclick = resetEncounter;
$('undoBtn').onclick = () => { const s = history.undo(); if (!s) return say('Nothing to undo.'); restore(s); say('Undone.'); };
const setTool = t => { tool = t; armedMoveId = null; for (const [k, id] of [['select', 'toolSelect'], ['aim', 'toolAim'], ['surface', 'toolSurface'], ['erase', 'toolErase']]) $(id).classList.toggle('active', t === k); say(t === 'select' ? 'Select / move mode.' : t === 'aim' ? 'Aim mode: click a tile (or token) to aim the chosen skill. The highlighted tiles are the area.' : t === 'surface' ? `Paint mode: ${D.SURFACES[$('surfaceType').value].label}.` : 'Erase mode.'); renderAll(); };
$('toolSelect').onclick = () => setTool('select'); $('toolAim').onclick = () => setTool('aim'); $('toolSurface').onclick = () => setTool('surface'); $('toolErase').onclick = () => setTool('erase');
$('surfaceType').onchange = () => { if (tool === 'surface') setTool('surface'); };
$('clearSurfaces').onclick = () => { if (Object.keys(surfaces).length) commit(() => { surfaces = {}; log('All surfaces cleared.'); }); };
$('resize').onclick = () => {
  const nc = Math.max(6, Math.min(30, Number($('cols').value) || 14)), nr = Math.max(6, Math.min(24, Number($('rows').value) || 10));
  commit(() => { cols = nc; rows = nr; surfaces = Object.fromEntries(Object.entries(surfaces).filter(([k]) => { const [x, y] = k.split(',').map(Number); return x < cols && y < rows; }));
    const placed = []; state.combatants.forEach(c => { let x = Math.min(cols - 1, c.x), y = Math.min(rows - 1, c.y); if (placed.some(p => p.x === x && p.y === y)) { for (let k = 0; k < cols * rows; k++) { const tx = k % cols, ty = Math.floor(k / cols); if (!placed.some(p => p.x === tx && p.y === ty)) { x = tx; y = ty; break; } } } c.x = x; c.y = y; placed.push({ x, y }); });
    $('cols').value = cols; $('rows').value = rows; log(`Grid resized to ${cols} × ${rows}.`); });
};
$('setApTurn').onchange = () => { settings.apPerTurn = Math.max(0, Number($('setApTurn').value) || 0); persist(); };
$('setMaxAp').onchange = () => { settings.maxAP = Math.max(0, Number($('setMaxAp').value) || 0); persist(); };
$('applyAp').onclick = () => commit(() => { state.combatants = state.combatants.map(c => ({ ...c, apPerTurn: settings.apPerTurn, maxAP: settings.maxAP, ap: Math.min(c.ap, settings.maxAP) })); log(`AP settings applied to all: +${settings.apPerTurn} per turn, max ${settings.maxAP}.`); });
const sel = () => byId(selectedId);
$('apMinus').onclick = () => { const c = sel(); if (c) setC(c.id, x => { x.ap = Math.max(0, x.ap - 1); }); else say('Select a combatant first.'); };
$('apPlus').onclick = () => { const c = sel(); if (c) setC(c.id, x => { x.ap = Math.min(x.maxAP, x.ap + 1); }); else say('Select a combatant first.'); };
$('apFull').onclick = () => { const c = sel(); if (c) setC(c.id, x => { x.ap = x.maxAP; }); else say('Select a combatant first.'); };
$('skipBtn').onclick = () => { const c = sel(); if (!c) return say('Select a combatant first.'); commit(() => { const x = byId(c.id); x.skipNext = !x.skipNext; log(`${x.name} ${x.skipNext ? 'will skip' : 'will no longer skip'} their next turn.`); }); };
$('defeatBtn').onclick = () => { const c = sel(); if (!c) return say('Select a combatant first.'); commit(() => { const x = byId(c.id); x.defeated = !x.defeated; if (!x.defeated && x.vitality <= 0) x.vitality = 1; log(`${x.name} ${x.defeated ? 'marked defeated' : 'revived'} (GM).`); }); };
$('surfaceTick').onclick = () => {
  if (!selectedTile) return say('Select a tile first.'); const k = tileKey(selectedTile.x, selectedTile.y), sf = surfaces[k], c = occupant(selectedTile.x, selectedTile.y);
  if (!sf) return say('Selected tile has no surface.'); if (!c) return say('No combatant on the selected tile.');
  commit(() => { const r = E.resolveSurface(c, sf, D.SURFACES); state.combatants = state.combatants.map(q => q.id === c.id ? r.target : q); logEvents(r.events); });
};
$('clearBoard').onclick = () => { if (confirm('Remove all combatants and surfaces? You can still Undo.')) commit(() => { state = { round: 1, activeId: null, combatants: [] }; surfaces = {}; selectedId = null; targets = new Set(); log('Board cleared.'); }); };
$('clearLog').onclick = () => commit(() => { logLines = []; });
$('saveBtn').onclick = () => { const blob = new Blob([JSON.stringify(E.serializeSave(currentSave()), null, 1)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = h('a', { href: url, download: ($('encName').value || 'encounter').replace(/[^\w-]+/g, '_') + '.json' }); a.click(); URL.revokeObjectURL(url); say('Encounter exported.'); };
$('loadBtn').onclick = () => $('loadFile').click();
$('loadFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const d = E.loadSave(JSON.parse(r.result), SURF_KEYS); history.push(snap()); applyLoaded(d); if (d.warnings.length) { alert('Imported with fixes:\n' + d.warnings.join('\n')); } log('Encounter imported.'); renderAll(); } catch (err) { alert('Could not import encounter: ' + err.message); } }; r.readAsText(f); e.target.value = ''; };

$('playerView').onchange = () => { dmView = !$('playerView').checked; renderAll(); say(dmView ? 'DM view.' : 'Player view: hidden units, enemy numbers, notes and the log are not shown.'); };
$('autoSurf').onchange = () => { settings.autoSurfaces = $('autoSurf').checked; persist(); };
$('zoomIn').onclick = () => { tilePx = Math.min(72, tilePx + 6); renderBoard(); };
$('zoomOut').onclick = () => { tilePx = Math.max(28, tilePx - 6); renderBoard(); };
$('addTemplate').onclick = () => addTemplate(1);
try { const raw = localStorage.getItem(KEY); if (raw) { applyLoaded(E.loadSave(JSON.parse(raw), SURF_KEYS)); say('Restored your last session (autosave).'); } } catch (e) { /* ignore corrupt autosave */ }
renderAll();
