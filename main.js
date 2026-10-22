let allCards = [];
let factions = [];
let uidCounter = 1;
const FACTION_THEMES = {
  'Goetia': { primary:'#8b0000', secondary:'#4b0082', base:55, type:'sawtooth' },
  'Zodiac': { primary:'#1e3a8a', secondary:'#9333ea', base:66, type:'sine' },
  'Red Rose Templars': { primary:'#dc2626', secondary:'#ffffff', base:73, type:'triangle' },
  'Dreamtime': { primary:'#d97706', secondary:'#1f2937', base:60, type:'sine' },
  'Yaoguai': { primary:'#111827', secondary:'#16a34a', base:50, type:'square' },
  'Celestial Host': { primary:'#fbbf24', secondary:'#3b82f6', base:82, type:'sine' },
  'Host of the Damned': { primary:'#6b7280', secondary:'#dc2626', base:48, type:'triangle' },
  'Oni': { primary:'#dc2626', secondary:'#1f2937', base:62, type:'sawtooth' },
  'Chthonic': { primary:'#312e81', secondary:'#6b7280', base:44, type:'sine' },
  'Melanesian': { primary:'#0ea5e9', secondary:'#10b981', base:68, type:'sine' },
  'Mesopotamian': { primary:'#78350f', secondary:'#16a34a', base:52, type:'sawtooth' },
  'Coven': { primary:'#16a34a', secondary:'#78350f', base:58, type:'triangle' },
  'Neutral': { primary:'#6b7280', secondary:'#9ca3af', base:60, type:'sine' },
};

function applyFactionTheme(faction) {
  const t = FACTION_THEMES[faction] || FACTION_THEMES['Neutral'];
  document.documentElement.style.setProperty('--accent', t.primary);
  document.documentElement.style.setProperty('--accent2', t.secondary);
  // store for music
  window.__factionBase = t.base;
  window.__factionType = t.type;
}

// Dynamic tug-of-war music update
let musicInterval = null;
function startDynamicMusic() {
  if (musicInterval) return;
  musicInterval = setInterval(() => {
    if (!G || !audioCtx) return;
    const diff = G.player.sanity - G.ai.sanity; // positive = player winning
    const base = window.__factionBase || 60;
    const targetFreq = base + Math.max(-10, Math.min(10, diff));
    // update ambient osc if exists
    if (window.__ambientOsc) {
      window.__ambientOsc.frequency.setTargetAtTime(targetFreq, audioCtx.currentTime, 0.5);
    }
    // adjust gain based on tension (low sanity)
    const tension = 1 - Math.min(G.player.sanity, G.ai.sanity) / 30;
    if (window.__ambientGain) {
      window.__ambientGain.gain.setTargetAtTime(0.012 + tension * 0.02, audioCtx.currentTime, 0.5);
    }
  }, 1000);
}

window.addEventListener('DOMContentLoaded', () => {
  const fs = document.getElementById('faction-select');
  if (fs) fs.addEventListener('change', (e) => { applyFactionTheme(e.target.value); });
  applyFactionTheme((fs && fs.value) || 'Neutral');
});

let G = null;
let selectedHandUid = null;
let attacking = new Set();
let profile = {};
let currentDeck = null;
let runState = null;
let difficulty = 'normal';

function loadProfile() {
  try { return JSON.parse(localStorage.getItem('chimera_profile') || '{}'); } catch(e){ return {}; }
}
function saveProfile() { localStorage.setItem('chimera_profile', JSON.stringify(profile)); }
function ensureProfile() {
  profile.xp = profile.xp || 0;
  profile.level = profile.level || 1;
  profile.unlocked = profile.unlocked || {};
  profile.stats = profile.stats || { wins:0, losses:0, unitsPlayed:0 };
  profile.quests = profile.quests || [];
  profile.achievements = profile.achievements || {};
  profile.decks = profile.decks || {};
  // unlock all common/uncommon by default
  if (!profile.initialized) {
    allCards.forEach(c => { if (c.rarity === 'Common' || c.rarity === 'Uncommon') profile.unlocked[c.id]=true; });
    profile.initialized = true;
    generateDailyQuests();
  }
  if (profile.quests.length === 0) generateDailyQuests();
}
function loadDeck() {
  try { return JSON.parse(localStorage.getItem('chimera_deck') || 'null'); } catch(e){ return null; }
}
function saveDeck(deck) { localStorage.setItem('chimera_deck', JSON.stringify(deck)); }


const $ = (id) => document.getElementById(id);

let rngSeed = Date.now();
function seededRandom() {
  rngSeed = (rngSeed * 1664525 + 1013904223) % 4294967296;
  return rngSeed / 4294967296;
}
function shuffle(arr, seed) {
  if (seed !== undefined) rngSeed = seed;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function log(msg) {
  const el = $('log');
  if (!el) return;
  const d = document.createElement('div');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
  // already
}

function hasKeyword(u, kw) {
  if (!u || u.silenced) return false;
  return (u.card.keywords || []).includes(kw);
}
function canBlock(blocker, attacker) {
  if (hasKeyword(attacker,'Flying') && !hasKeyword(blocker,'Flying') && !hasKeyword(blocker,'Reach')) return false;
  return true;
}
function effAtk(u) { let v=(u.card.atk||0)+(u.buffAtk||0); if (G && G.location && G.location.effect==='atkBoost') v+=1; const o = (typeof ownerOf==='function')? ownerOf(u) : null; if (o && o.faction==='Melanesian' && o.tide==='High') v+=1; if (u.fallen) v+=2; return v; }
function effHp(u) { let v=(u.card.hp||0)+(u.buffHp||0); if (G && G.location && G.location.effect==='hpBoost') v+=1; const o = (typeof ownerOf==='function')? ownerOf(u) : null; if (o && o.faction==='Melanesian' && o.tide==='Low') v+=1; return v; }
function isAlive(u) { return !!u && (u.damage || 0) < effHp(u); }

function active() { return G.turn === 'player' ? G.player : G.ai; }
function opponentOf(p) { return p === G.player ? G.ai : G.player; }
function ownerOf(u) {
  if (G.player.front.includes(u) || G.player.back.includes(u)) return G.player;
  return G.ai;
}

function buildDeck(faction) {
  let pool = allCards.filter(c => c.faction === faction && c.type !== 'Token');
  let deck = [...pool];
  if (deck.length < 40) {
    const neutrals = allCards.filter(c => c.faction === 'Neutral' && c.type !== 'Token');
    while (deck.length < 40 && neutrals.length) {
      deck.push(neutrals[Math.floor(Math.random() * neutrals.length)]);
    }
  }
  deck = deck.slice(0, 40);
  return shuffle(deck);
}

function createPlayer(name, faction, deck) {
  return { name, faction, sanity: 30, essence: 0, maxEssence: 0, deck: [...deck], hand: [], front: [], back: [], discard: [], void: [], tide: 'High', wheel: 0, cycle: 0, fallen: false, playedNonFaction: false, lastPlayed: null };
}

function draw(p) {
  if (p.deck.length === 0) {
    // fatigue
    p.sanity -= 1;
    log(p.name + ' has no cards (fatigue).');
    checkGameOver();
    return;
  }
  const card = p.deck.shift();
  const inst = { uid: uidCounter++, card, tapped: false, damage: 0, playedTurn: G.turnNumber, buffAtk: 0, buffHp: 0, shadeUsed: false };
  if (p.hand.length >= 7) {
    p.discard.push(inst);
  } else {
    p.hand.push(inst);
  }
}

function summonUnit(p, inst, row) {
  inst.owner = p;
  inst.playedTurn = G.turnNumber;
  inst.tapped = false;
  inst.damage = 0;
  if (row === 'front') {
    if (p.front.length >= 4) row = 'back';
  }
  if (row === 'back') {
    if (p.back.length >= 2) {
      // no space: discard
      p.discard.push(inst);
      log(p.name + ' has no space; card discarded.');
      return false;
    }
    p.back.push(inst);
  } else {
    p.front.push(inst);
  }
  inst.row = row;
  inst.armor = inst.armor || 0;
  inst.plague = inst.plague || 0;
  (inst.card.effects||[]).forEach(e => { const m = (e.action||'').match(/Plague\s*(\d+)/i); if (m) inst.plague = Math.max(inst.plague, parseInt(m[1])); });
  if ((inst.card.keywords||[]).includes('Plague') && !inst.plague) inst.plague = 1;
  (inst.card.effects||[]).forEach(e => {
    const m = (e.action||'').match(/Armor\s*(\d+)/i);
    if (m) inst.armor = Math.max(inst.armor, parseInt(m[1]));
  });
  if (hasKeyword(inst, 'Haste')) inst.tapped = false;
  return true;
}

function removeUnitFromBoard(p, u) {
  p.front = p.front.filter(x => x !== u);
  p.back = p.back.filter(x => x !== u);
}

function destroyUnit(u, owner) {
  if (!u) return;
  const o = owner || ownerOf(u);
  removeUnitFromBoard(o, u);
  o.discard.push(u);
  // Shade revive
  if (hasKeyword(u, 'Shade') && !u.shadeUsed) {
    u.shadeUsed = true;
    G.reviveQueue = G.reviveQueue || [];
    G.reviveQueue.push({ u, owner: o });
  }
  G.destroyedCount = (G.destroyedCount || 0) + 1;
  if (G.lastKiller && owner !== G.lastKiller) { G.lastKiller.essence += 1; }
  // Faction essence generation
  [G.player, G.ai].forEach(pl => {
    if (!pl) return;
    if (pl.faction === 'Goetia') pl.essence += 1;
    if (pl.faction === 'Yaoguai' && ownerOf(u) !== pl) pl.essence += 1;
  });
  // Oni essence: when an Oni unit destroys an enemy in combat handled separately
  log((u.card.name) + ' destroyed.');
  sfx(110, 0.18, 'square', 0.05);
  document.body.classList.add('shake'); setTimeout(()=>document.body.classList.remove('shake'),400);
  checkGameOver();
}

function applyDamageUnit(u, amount, sourceOwner) {
  if (!u) return;
  const owner = ownerOf(u);
  const reduced = Math.max(0, amount - (u.armor||0));
  u.damage = (u.damage || 0) + reduced;
  const o = ownerOf(u);
  if (o && o.faction === 'Host of the Damned' && !u.fallen && u.damage >= Math.ceil(effHp(u)/2)) { u.fallen = true; u.buffAtk = (u.buffAtk||0)+2; log(u.card.name + ' becomes Fallen!'); }
  // float damage number
  const el = document.querySelector('[data-uid="' + u.uid + '"]');
  if (el) {
    const r = el.getBoundingClientRect();
    floatText(r.left + r.width/2, r.top, '-' + amount, '#ff4d6d');
    el.classList.add('damaged');
    setTimeout(() => el.classList.remove('damaged'), 400);
  }
  sfx(220, 0.08, 'sawtooth', 0.04);
  if (u.damage >= effHp(u)) {
    if (el) el.classList.add('dying');
    destroyUnit(u, owner);
  }
}

function factionBonus(p, timing) {
  if (!G) return 0;
  switch (p.faction) {
    case 'Chthonic': return Math.floor(p.discard.length / 5);
    case 'Zodiac': return Math.min(5, p.front.filter(u=>u.card.faction==='Zodiac').length);
    case 'Coven': return 1;
    case 'Melanesian': { if (!p._tide) p._tide='High'; p._tide = (p._tide==='High')?'Low':'High'; return 1; }
    case 'Dreamtime': return Math.min(4, p.back.filter(u=>u.card.type==='Location').length);
    case 'Goetia': return 0; // handled on destruction
    case 'Oni': return 0;
    case 'Yaoguai': return 0;
    case 'Red Rose Templars': return p.front.length >= 3 ? 1 : 0;
    case 'Celestial Host': return Math.min(3, p.back.filter(u=>u.card.type==='Location').length);
    case 'Host of the Damned': return p.front.filter(u=>u.fallen).length;
    case 'Mesopotamian': {
      const plagued = (p === G.player ? G.ai : G.player).front.concat((p===G.player?G.ai:G.player).back).filter(u => (u.plague||0)>0).length;
      return Math.min(2, plagued);
    }
    default: return 0;
  }
}

function startTurn(who) {
  G.turn = who;
  G.phase = 'upkeep';
  G.reviveQueue = [];
  G.attackedThisTurn = false;
  active().playedNonFaction = false;
  const p = active();
  // Plague damage at start of turn
  [...p.front, ...p.back].filter(Boolean).forEach(u => { if (u.plague) { applyDamageUnit(u, u.plague, null); } });
  // Faction passives
  if (p.faction === 'Melanesian') { p.tide = (p.tide==='High')?'Low':'High'; log(p.name + ' tide: ' + p.tide); }
  if (p.faction === 'Zodiac') { p.cycle = ((p.cycle||0)+1)%13; log(p.name + ' cycle advances.'); }
  if (p.faction === 'Coven') { p.wheel = (p.wheel||0)+1; log(p.name + ' wheel advances to ' + p.wheel); }
  if (p.faction === 'Host of the Damned') { log(p.name + ' endures.'); }
  // Chaos mode modifier
  if (localStorage.getItem('chimera_chaos') === '1') {
    const r = Math.random();
    if (r < 0.33) { active().essence += 2; log('Chaos: +2 Essence!'); }
    else if (r < 0.66) { const units = active().front; if (units.length) { const u = units[Math.floor(Math.random()*units.length)]; u.buffAtk = (u.buffAtk||0)+2; log('Chaos: ' + u.card.name + ' gains +2 ATK!'); } }
    else { log('Chaos: nothing happens.'); }
  }
  G.turnNumber++;
  // revive shades from previous? Apply revives scheduled at end of previous turn now? We'll apply at start.
  if (G.pendingRevives && G.pendingRevives.length) {
    G.pendingRevives.forEach(({ u, owner }) => {
      u.damage = 0;
      u.tapped = true;
      if (owner.front.length < 5) owner.front.push(u); else if (owner.back.length < 3) owner.back.push(u);
    });
    G.pendingRevives = [];
  }
  // max essence
  p.maxEssence = Math.min(10, p.maxEssence + 1);
  p.essence = p.maxEssence + factionBonus(p, 'upkeep');
  // reset tapped
  p.front.forEach(u => { u.tapped = false; });
  p.back.forEach(u => { u.tapped = false; });
  // triggers start of turn: draw additional? skip
  G.phase = 'draw';
  const isFirstPlayerFirstTurn = (who === 'player' && G.turnNumber === 2); // turnNumber 2 means first player's first? Actually first startTurn called with turnNumber 1? Let's adjust.
  // We'll handle skip draw: player skips draw on very first turn of game.
  // Track G.firstTurnPlayerDone
  let skipDraw = false;
  if (who === 'player' && !G.playerFirstDrawDone) { skipDraw = true; G.playerFirstDrawDone = true; }
  if (!skipDraw) draw(p);
  G.phase = 'main';
  selectedHandUid = null;
  attacking.clear();
  render();
  log(p.name + "'s turn. (Essence " + p.essence + ")");
  if (p === G.player) showTurnBanner('YOUR TURN');
  sfx(520, 0.12, 'sine', 0.05);
  if (who === 'ai') scheduleAI();
}

function endTurn() {
  const p = active();
  // end triggers
  G.phase = 'end';
  // damage cleanup
  p.front.forEach(u => u.damage = 0);
  p.back.forEach(u => u.damage = 0);
  const opp = opponentOf(p);
  opp.front.forEach(u => u.damage = 0);
  opp.back.forEach(u => u.damage = 0);
  // essence empty
  p.essence = 0;
  // hand discard to 7
  while (p.hand.length > 7) {
    p.discard.push(p.hand.pop());
  }
  // schedule revives: move reviveQueue to pending
  G.pendingRevives = G.pendingRevives || [];
  if (G.reviveQueue && G.reviveQueue.length) G.pendingRevives.push(...G.reviveQueue);
  G.reviveQueue = [];
  // end buffs? we don't track temp buffs separately
  // pass turn
  if (G.turn === 'player') {
    startTurn('ai');
  } else {
    startTurn('player');
  }
}

function checkGameOver() {
  if (G.player.sanity <= 0) { gameOver('AI wins!', 'Your sanity was shattered.'); return true; }
  if (G.ai.sanity <= 0) { gameOver('You win!', 'You shattered the AI\'s sanity.'); return true; }
  if (G.player.deck.length === 0 && G.player.hand.length === 0) { /* not immediate */ }
  return false;
}
function gameOver(title, msg) {
  $('gameover-title').textContent = title;
  $('gameover-msg').textContent = msg;
  $('gameover').classList.remove('hidden');
}

function cardCost(inst) {
  let cost = inst.card.cost || 0;
  if (!G || !G.location) return cost;
  if (G.location.effect === 'unitDiscount' && inst.card.type === 'Unit') cost = Math.max(0, cost-1);
  if (G.location.effect === 'spellDiscount' && inst.card.type === 'Invocation') cost = Math.max(0, cost-1);
  return cost;
}
function canPlayCard(p, inst) {
  const c = inst.card;
  if (c.type === 'Unit' || c.type === 'Invocation' || c.type === 'Relic' || c.type === 'Location') {
    return p.essence >= cardCost(inst);
  }
  return false;
}

function playCard(inst, ev) {
  sfx(660, 0.1, 'triangle', 0.05);
  spawnSparks(ev);
  const p = active();
  if (G.turn !== 'player') return;
  if (!p.hand.find(x => x.uid === inst.uid)) return;
  if (!canPlayCard(p, inst)) { log('Not enough essence.'); return; }
  const c = inst.card;
  if (!p.playedNonFaction) { if (c.faction !== p.faction) p.playedNonFaction = true; }
  // Goetia pact: sacrifice weakest friendly unit for +2/+2
  if (p.faction === 'Goetia' && c.type === 'Unit' && p.front.length > 0) {
    const sac = p.front.slice().sort((a,b)=>effAtk(a)-effAtk(b))[0];
    if (sac) { destroyUnit(sac, p); inst.buffAtk = (inst.buffAtk||0)+2; inst.buffHp = (inst.buffHp||0)+2; log('Pact: sacrificed ' + sac.card.name); }
  }
  p.essence -= cardCost(inst);
  // remove from hand
  p.hand = p.hand.filter(x => x.uid !== inst.uid);

  if (c.type === 'Unit') {
    summonUnit(p, inst, 'front');
    // arrival effects? skip
    if (p.faction === 'Red Rose Templars' && !p.playedNonFaction) { p.essence += 1; log(p.name + ' gains Hallowed Essence (Zeal).'); }
  log(p.name + ' plays ' + c.name);
  } else if (c.type === 'Invocation') {
    if (p.faction === 'Chthonic' && p.discard.length > 0) { const pick = p.discard.splice(Math.floor(Math.random()*p.discard.length),1)[0]; p.hand.push(pick); log('Katabasis returns ' + pick.card.name); }
    if (p.faction === 'Celestial Host' && (p.front.length + p.back.length) >= 3) { draw(p); log('Call resonates.'); }
    if (p.faction === 'Yaoguai' && G.lastPlayedFaction && G.lastPlayedFaction !== 'Yaoguai') { draw(p); log('Judgment triggered.'); }
    resolveInvocation(inst, p, opponentOf(p));
    p.discard.push(inst);
    log(p.name + ' casts ' + c.name);
  } else if (c.type === 'Relic') {
    // treat as permanent in back row
    summonUnit(p, { ...inst, card: { ...c, atk: 0, hp: 1, keywords: [] } }, 'back');
    log(p.name + ' plays relic ' + c.name);
  } else if (c.type === 'Location') {
    // back row
    if (p.back.length < 3) {
      inst.row = 'back';
      p.back.push(inst);
      log(p.name + ' plays location ' + c.name);
    } else {
      p.discard.push(inst);
      log('No space for location.');
    }
  }
  G.lastPlayedFaction = p.faction;
  render();
  checkGameOver();
}

function resolveInvocation(inst, player, opponent, chosenTarget) {
  const card = inst.card;
  const effects = card.effects || [];
  // LIFO resolution
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const action = e.action || '-';
    if (action === '-') continue;
    const lower = action.toLowerCase();
    const nums = action.match(/\d+/g) || [];
    const n = nums.length ? parseInt(nums[0]) : 0;

    if (lower.includes('deal') && lower.includes('damage')) {
      let dmg = n || (e.value && e.value.damage) || 1;
      // if target unit specified
      if (chosenTarget) {
        if (chosenTarget === 'face') opponent.sanity -= dmg;
        else applyDamageUnit(chosenTarget, dmg, player);
      } else if (lower.includes('to any target') || lower.includes('to any')) {
        const targets = opponent.front.concat(opponent.back).filter(Boolean);
        const killable = targets.find(u => (effHp(u) - (u.damage||0)) <= dmg);
        if (killable) applyDamageUnit(killable, dmg, player);
        else opponent.sanity -= dmg;
      } else if (lower.includes('to your nexus') || lower.includes('to own')) {
        player.sanity -= dmg;
      } else {
        // default damage opponent sanity
        const targets = opponent.front.concat(opponent.back).filter(Boolean);
        if (targets.length && lower.includes('unit')) {
          const t = targets.sort((a,b)=>(b.card.atk||0)-(a.card.atk||0))[0];
          applyDamageUnit(t, dmg, player);
        } else {
          opponent.sanity -= dmg;
        }
      }
    } else if (lower.includes('heal your nexus')) {
      let amt = n || 3;
      player.sanity += amt;
    } else if (lower.includes('draw')) {
      let count = 1;
      if (lower.includes('two')) count = 2;
      if (lower.includes('three')) count = 3;
      if (n >= 2 && n <= 3) count = n;
      for (let i = 0; i < count; i++) draw(player);
    } else if (lower.includes('destroy target unit')) {
      if (chosenTarget && chosenTarget !== 'face') destroyUnit(chosenTarget, ownerOf(chosenTarget));
      else {
        const targets = opponent.front.filter(Boolean);
        if (targets.length) {
          const t = targets.sort((a,b)=>(b.card.atk||0)-(a.card.atk||0))[0];
          destroyUnit(t, opponent);
        }
      }
    } else if (lower.includes('destroy all units')) {
      [...player.front, ...player.back, ...opponent.front, ...opponent.back].filter(Boolean).forEach(u => destroyUnit(u, ownerOf(u)));
    } else if (lower.includes('opponent discards') || lower.includes('your opponent discards')) {
      let count = lower.includes('two') ? 2 : 1;
      for (let i = 0; i < count && opponent.hand.length; i++) {
        const idx = Math.floor(Math.random() * opponent.hand.length);
        opponent.discard.push(opponent.hand.splice(idx, 1)[0]);
      }
    } else if (lower.includes('return a friendly unit to your hand')) {
      const units = player.front.concat(player.back).filter(Boolean);
      if (units.length) {
        const u = units[units.length - 1];
        removeUnitFromBoard(player, u);
        player.hand.push(u);
      }
    } else if (lower.includes('create') && lower.includes('token')) {
      let count = lower.includes('two') ? 2 : 1;
      let atk = 1, hp = 1;
      const mm = action.match(/(\d+)\/(\d+)/);
      if (mm) { atk = parseInt(mm[1]); hp = parseInt(mm[2]); }
      for (let i = 0; i < count; i++) {
        const tokenCard = { id: 'TOKEN', name: 'Token', type: 'Unit', faction: player.faction, rarity: 'Common', cost: 0, atk, hp, keywords: [], effects: [] };
        const inst2 = { uid: uidCounter++, card: tokenCard, tapped: false, damage: 0, playedTurn: G.turnNumber, buffAtk: 0, buffHp: 0, shadeUsed: false };
        summonUnit(player, inst2, 'front');
      }
    } else if (lower.includes('give a friendly unit') || lower.includes('give all')) {
      const m = action.match(/\+(\d+)\/\+(\d+)/);
      if (m) {
        const units = player.front.concat(player.back).filter(Boolean);
        if (units.length) {
          const u = units.sort((a,b)=>(b.card.atk||0)-(a.card.atk||0))[0];
          u.buffAtk = (u.buffAtk || 0) + parseInt(m[1]);
          u.buffHp = (u.buffHp || 0) + parseInt(m[2]);
        }
      }
    } else if (lower.includes('gain control of target enemy unit') || lower.includes('gain control of target enemy')) {
      const units = opponent.front.filter(Boolean);
      if (units.length) {
        const u = units[0];
        removeUnitFromBoard(opponent, u);
        summonUnit(player, u, 'front');
      }
    } else if (lower.includes('search your library')) {
      draw(player);
    } else if (lower.includes('silence')) {
      const targets = opponent.front.concat(opponent.back).filter(Boolean);
      if (targets.length) {
        const t = targets.sort((a,b)=>(b.card.atk||0)-(a.card.atk||0))[0];
        t.silenced = true;
        t.buffAtk = 0; t.buffHp = 0;
        log(t.card.name + ' silenced.');
      }
    } else if (lower.includes('destroy target relic') || lower.includes('destroy target location') || lower.includes('destroy target enemy location')) {
      const targets = opponent.back.filter(u => u && (u.card.type === 'Relic' || u.card.type === 'Location'));
      if (targets.length) destroyUnit(targets[0], opponent);
      else if (opponent.back.length) destroyUnit(opponent.back[opponent.back.length-1], opponent);
    } else if (lower.includes('gain') && lower.includes('essence')) {
      player.essence += (n || 1);
    } else {
      // Unimplemented effect; log honestly
      log('Effect not yet implemented: ' + action.slice(0,60));
    }
  }
}

function isPreemptive(u) { return hasKeyword(u, 'Preemptive') || hasKeyword(u, 'First Strike'); }
function hasDoubleStrike(u) { return hasKeyword(u, 'Double Strike'); }

function declareAttack() {
  if (G.turn !== 'player' || G.phase !== 'main') return;
  if (attacking.size === 0) { log('No attackers selected.'); return; }
  const attackers = [...attacking].map(uid => G.player.front.find(u => u && u.uid === uid)).filter(Boolean);
  // tap (Vigilance doesn't tap)
  attackers.forEach(u => { if (!hasKeyword(u,'Vigilance')) u.tapped = true; });
  // AI blocks
  const blockMap = new Map();
  const usedBlockers = new Set();
  // simple: for each attacker, find best blocker
  attackers.forEach(a => {
    const candidates = (hasKeyword(a,'Stealth')) ? [] : G.ai.front.filter(u => u && !u.tapped && !usedBlockers.has(u.uid) && canBlock(u,a));
    if (candidates.length === 0) { blockMap.set(a.uid, null); return; }
    // choose blocker that can kill attacker with least cost, else highest hp
    let best = null;
    // prefer kill
    const killers = candidates.filter(b => effAtk(b) >= effHp(a) - (a.damage||0));
    if (killers.length) best = killers.sort((a,b)=>effHp(a)-effHp(b))[0];
    else best = candidates.sort((a,b)=>effHp(b)-effHp(a))[0];
    if (best) { usedBlockers.add(best.uid); blockMap.set(a.uid, best); }
    else blockMap.set(a.uid, null);
  });
  resolveCombat(G.player, G.ai, attackers, blockMap);
  attacking.clear();
  G.attackedThisTurn = true;
  if (G.player.faction === 'Red Rose Templars' && attackers.length >= 3) {
    G.player.front.forEach(u => { if (u.card.faction === 'Red Rose Templars') { u.buffAtk=(u.buffAtk||0)+1; u.buffHp=(u.buffHp||0)+1; } });
    log('Crusade! Templar units gain +1/+1.');
  }
  render();
  checkGameOver();
}

function resolveCombat(attackerPlayer, defenderPlayer, attackers, blockMap) {
  G.lastKiller = (attackerPlayer.faction === 'Oni') ? attackerPlayer : null;
  // Preemptive step
  // attackers with preemptive/double strike deal damage
  attackers.forEach(a => {
    if (!isAlive(a)) return;
    const b = blockMap.get(a.uid);
    if (isPreemptive(a) || hasDoubleStrike(a)) {
      if (b && isAlive(b)) {
        applyDamageUnit(b, effAtk(a), attackerPlayer);
      } else if (!b) {
        if (!a._dealtSanity) { defenderPlayer.sanity -= effAtk(a); a._dealtSanity = true; if (hasKeyword(a,'Lifesteal')) attackerPlayer.sanity += effAtk(a); }
      }
    }
  });
  // blockers with preemptive/double strike deal damage
  attackers.forEach(a => {
    const b = blockMap.get(a.uid);
    if (b && isAlive(b) && (isPreemptive(b) || hasDoubleStrike(b))) {
      if (isAlive(a)) applyDamageUnit(a, effAtk(b), defenderPlayer);
    }
  });
  // Overwhelm excess for preemptive? skip

  // Regular step
  attackers.forEach(a => {
    if (!isAlive(a)) return;
    const b = blockMap.get(a.uid);
    const purePreemptive = hasKeyword(a,'Preemptive') || hasKeyword(a,'First Strike');
    const ds = hasDoubleStrike(a);
    if (!purePreemptive && !ds) {
      if (b && isAlive(b)) {
        const before = effHp(b) - (b.damage||0);
        applyDamageUnit(b, effAtk(a), attackerPlayer);
        if (hasKeyword(a,'Overwhelm') && effAtk(a) > before) {
          defenderPlayer.sanity -= (effAtk(a) - before);
        }
        if (hasKeyword(a,'Lifesteal')) attackerPlayer.sanity += Math.min(effAtk(a), before);
      } else if (!b) {
        if (!a._dealtSanity) { defenderPlayer.sanity -= effAtk(a); a._dealtSanity = true; if (hasKeyword(a,'Lifesteal')) attackerPlayer.sanity += effAtk(a); }
      }
    } else if (ds) {
      // second hit
      if (b && isAlive(b)) {
        const before = effHp(b) - (b.damage||0);
        applyDamageUnit(b, effAtk(a), attackerPlayer);
        if (hasKeyword(a,'Overwhelm') && effAtk(a) > before) {
          defenderPlayer.sanity -= (effAtk(a) - before);
        }
      } else if (!b) {
        if (!a._dealtSanity) { /* already dealt first in preemptive */ }
        else { defenderPlayer.sanity -= effAtk(a); if (hasKeyword(a,'Lifesteal')) attackerPlayer.sanity += effAtk(a); }
      }
    }
  });
  // blockers regular damage (non-preemptive)
  attackers.forEach(a => {
    const b = blockMap.get(a.uid);
    if (!b || !isAlive(b)) return;
    if (isAlive(a)) {
      const blockerPurePreemptive = hasKeyword(b,'Preemptive') || hasKeyword(b,'First Strike');
      const blockerDS = hasDoubleStrike(b);
      if (!blockerPurePreemptive && !blockerDS) {
        applyDamageUnit(a, effAtk(b), defenderPlayer);
      } else if (blockerDS) {
        // second hit for double strike
        applyDamageUnit(a, effAtk(b), defenderPlayer);
      }
    }
  });
  // cleanup flags
  attackers.forEach(a => { delete a._dealtSanity; });
  G.lastKiller = null;
}

// AI turn
function scheduleAI() {
  setTimeout(() => aiTurn(), 600);
}
function aiTurn() {
  if (G.turn !== 'ai') return;
  const p = G.ai;
  const opp = G.player;
  // play cards
  let played = true;
  while (played) {
    played = false;
    // sort hand by cost asc
    const playable = p.hand.filter(c => canPlayCard(p, c)).sort((a,b)=> (a.card.cost||0)-(b.card.cost||0));
    for (const inst of playable) {
      if (inst.card.type === 'Unit') {
        if (p.front.length >= 5 && p.back.length >= 3) continue;
      }
      playCardAI(inst);
      played = true;
      break;
    }
  }
  // attack with all eligible
  const eligible = p.front.filter(u => u && !u.tapped && !hasKeyword(u,'Defender') && (u.playedTurn < G.turnNumber || hasKeyword(u,'Haste'))).filter(a => {
    const blockers = G.player.front.filter(b=>b && !b.tapped);
    if (blockers.length === 0) return true;
    const canKill = blockers.some(b => effAtk(a) >= effHp(b));
    const survives = blockers.every(b => effHp(a) > effAtk(b));
    return canKill || survives || Math.random() < 0.25;
  });
  if (eligible.length) {
    eligible.forEach(u => attacking.add(u.uid));
    // reuse declare but for ai
    const attackers = [...attacking].map(uid => p.front.find(u=>u&&u.uid===uid)).filter(Boolean);
    attackers.forEach(u=>{ if(!hasKeyword(u,'Vigilance')) u.tapped=true; });
    // player auto-block
    const blockMap = new Map();
    const used = new Set();
    attackers.forEach(a => {
      const candidates = (hasKeyword(a,'Stealth')) ? [] : G.player.front.filter(u=>u && !u.tapped && !used.has(u.uid) && canBlock(u,a));
      if (!candidates.length) { blockMap.set(a.uid,null); return; }
      // block if can kill or protect sanity: choose highest power
      const killers = candidates.filter(b=>effAtk(b) >= effHp(a)-(a.damage||0));
      let best = killers.length ? killers.sort((a,b)=>effHp(a)-effHp(b))[0] : candidates.sort((a,b)=>effAtk(b)-effAtk(a))[0];
      if (best) { used.add(best.uid); blockMap.set(a.uid,best); }
      else blockMap.set(a.uid,null);
    });
    resolveCombat(p, G.player, attackers, blockMap);
    attacking.clear();
    render();
    checkGameOver();
  }
  setTimeout(() => {
    if (G && G.turn === 'ai') endTurn();
  }, 800);
}

function playCardAI(inst) {
  const p = G.ai;
  p.essence -= cardCost(inst);
  p.hand = p.hand.filter(x => x.uid !== inst.uid);
  const c = inst.card;
  if (c.type === 'Unit') {
    summonUnit(p, inst, 'front');
  } else if (c.type === 'Invocation') {
    resolveInvocation(inst, p, G.player);
    p.discard.push(inst);
  } else if (c.type === 'Relic' || c.type === 'Location') {
    if (p.back.length < 3) p.back.push(inst); else p.discard.push(inst);
  }
  log('AI plays ' + c.name);
}

function render() {
  if (!G) return;
  // topbar
  const _on = $('opp-name'); if (_on) _on.textContent = G.ai.name + ' (' + G.ai.faction + ')';
  const _os = $('opp-sanity'); if (_os) _os.textContent = G.ai.sanity;
  const oppFill = document.getElementById('opp-lp-fill'); if (oppFill) oppFill.style.width = Math.max(0, Math.min(100, (G.ai.sanity/30)*100)) + '%';
  const _oe = $('opp-essence'); if (_oe) _oe.textContent = G.ai.essence;
  const _od = $('opp-deck'); if (_od) _od.textContent = G.ai.deck.length;
  const _oh = $('opp-hand'); if (_oh) _oh.textContent = G.ai.hand.length;
  const _sn = $('self-name'); if (_sn) _sn.textContent = G.player.name + ' (' + G.player.faction + ')';
  const _ss = $('self-sanity'); if (_ss) _ss.textContent = G.player.sanity;
  const selfFill = document.getElementById('self-lp-fill'); if (selfFill) selfFill.style.width = Math.max(0, Math.min(100, (G.player.sanity/30)*100)) + '%';
  const st = document.getElementById('self-sanity-track'); if (st) { if (!st.querySelector('.track-fill')) { const f=document.createElement('div'); f.className='track-fill'; st.appendChild(f); } st.querySelector('.track-fill').style.height = Math.max(0,Math.min(100,(G.player.sanity/30)*100))+'%'; }
  const et = document.getElementById('self-essence-track'); if (et) { if (!et.querySelector('.track-fill')) { const f=document.createElement('div'); f.className='track-fill'; et.appendChild(f); } et.querySelector('.track-fill').style.height = Math.max(0,Math.min(100,(G.player.essence/10)*100))+'%'; }
  const _se = $('self-essence'); if (_se) _se.textContent = G.player.essence;
  const _sd = $('self-deck'); if (_sd) _sd.textContent = G.player.deck.length;
  const _tl = $('turn-label'); if (_tl) _tl.textContent = 'Turn ' + Math.ceil(G.turnNumber/2) + ' - ' + (G.turn === 'player' ? 'Your Turn' : "AI's Turn");
  const oppDeck = document.getElementById('opp-deck-pile'); if (oppDeck) oppDeck.textContent = 'Deck\n' + G.ai.deck.length;
  const oppDisc = document.getElementById('opp-discard-pile'); if (oppDisc) oppDisc.textContent = 'Discard\n' + G.ai.discard.length;
  const selfDeck = document.getElementById('self-deck-pile'); if (selfDeck) selfDeck.textContent = 'Deck\n' + G.player.deck.length;
  const selfDisc = document.getElementById('self-discard-pile'); if (selfDisc) selfDisc.textContent = 'Discard\n' + G.player.discard.length;
  const ri = $('run-info'); if (ri) ri.textContent = G.location ? ('📍 ' + G.location.name) : '';
  const fz = document.getElementById('field-zone'); if (fz) fz.textContent = G.location ? ('Field: ' + G.location.name) : 'Field: none';
  const fs = $('faction-state'); if (fs && G) { const p=G.player; let txt=''; if (p.faction==='Zodiac') txt='Cycle: '+(p.cycle||0); else if (p.faction==='Coven') txt='Wheel: '+(p.wheel||0); else if (p.faction==='Melanesian') txt='Tide: '+(p.tide||'High'); else txt=p.faction; fs.textContent=txt; }
  const _pl = $('phase-label'); if (_pl) _pl.textContent = (G.phase || '').charAt(0).toUpperCase() + (G.phase||'').slice(1) + ' Phase';

  // boards
  // Render into individual slots
  for (let i=0;i<4;i++) {
    const ob = document.getElementById('opp-back-'+i);
    if (ob) { ob.innerHTML = ''; if (G.ai.back[i]) ob.appendChild(unitEl(G.ai.back[i])); }
    const ofr = document.getElementById('opp-front-'+i);
    if (ofr) { ofr.innerHTML = ''; if (G.ai.front[i]) ofr.appendChild(unitEl(G.ai.front[i])); }
    const sf = document.getElementById('self-front-'+i);
    if (sf) { sf.innerHTML = ''; if (G.player.front[i]) sf.appendChild(unitEl(G.player.front[i])); }
    const sb = document.getElementById('self-back-'+i);
    if (sb) { sb.innerHTML = ''; if (G.player.back[i]) sb.appendChild(unitEl(G.player.back[i])); }
  }
  const oppPact = document.getElementById('opp-pact'); if (oppPact) { oppPact.innerHTML='Pact'; }
  const selfPact = document.getElementById('self-pact'); if (selfPact) { selfPact.innerHTML='Pact'; }

  // hand
  const handEl = document.getElementById('hand');
  if (!handEl) return;
  handEl.innerHTML = '';
  G.player.hand.forEach(inst => {
    const el = cardEl(inst, true);
    if (G.turn === 'player' && canPlayCard(G.player, inst)) el.classList.add('playable');
    if (selectedHandUid === inst.uid) el.classList.add('selected');
    el.addEventListener('click', (e) => {
      if (G.turn !== 'player') return;
      if (!canPlayCard(G.player, inst)) { log('Not enough essence for ' + inst.card.name); return; }
      selectedHandUid = null;
      playCard(inst, e);
    });
    handEl.appendChild(el);
  });

  // attack button enable
  $('attack-btn').disabled = !(G.turn === 'player' && G.phase === 'main');
  const cb = document.getElementById('faction-ability-btn'); if (cb) cb.style.display = (G && G.player && G.turn === 'player') ? '' : 'none';
}

function renderBoardRow(id, arr, opponent) {
  const el = $(id);
  el.innerHTML = '';
  arr.forEach(u => {
    const cel = unitEl(u);
    if (attacking.has(u.uid)) cel.classList.add('selected');
    cel.addEventListener('click', () => {
      if (G.turn !== 'player' || G.phase !== 'main') return;
      if (opponent) return;
      // toggle attacker if in front row and eligible
      if (id === 'self-front') {
        const eligible = !u.tapped && !hasKeyword(u,'Defender') && (u.playedTurn < G.turnNumber || hasKeyword(u,'Haste'));
        if (!eligible) return;
        if (attacking.has(u.uid)) attacking.delete(u.uid);
        else attacking.add(u.uid);
        render();
      }
    });
    el.appendChild(cel);
  });
}

function cardEl(inst, inHand) {
  const c = inst.card;
  const el = document.createElement('div');
  el.className = 'card rarity-' + (inst.card.rarity||'Common').toLowerCase().replace(' ','-');
  el.dataset.uid = inst.uid;
  el.setAttribute('role','button');
  el.setAttribute('tabindex','0');
  el.setAttribute('aria-label', inst.card.name);
  el.innerHTML = `
    <div class="cost">${c.cost ?? 0}</div>
    <div class="art">${c.faction ? c.faction.charAt(0) : '?'}</div>
    <div class="name">${c.name}</div>
    <div class="type">${c.type}${c.subtype ? ' - ' + c.subtype : ''}</div>
    ${c.type === 'Unit' ? `<div class="stats">${effAtk(inst)}/${effHp(inst) - (inst.damage||0)}</div>` : ''}
    <div class="kw">${(c.keywords||[]).join(', ')}</div>
    <div class="effect">${(c.effects||[]).map(e=>e.action).join('; ')}</div>
  `;
  return el;
}

function unitEl(u) {
  const el = document.createElement('div');
  el.className = 'card board-card rarity-' + (u.card.rarity||'Common').toLowerCase().replace(' ','-') + (u.tapped ? ' tapped' : '');
  el.dataset.uid = u.uid;
  el.setAttribute('role','button');
  el.setAttribute('tabindex','0');
  el.setAttribute('aria-label', u.card.name);
  el.innerHTML = `
    <div class="cost">${u.card.cost ?? 0}</div>
    <div class="art">${u.card.faction ? u.card.faction.charAt(0) : '?'}</div>
    <div class="name">${u.card.name}</div>
    <div class="stats">${effAtk(u)}/${effHp(u) - (u.damage||0)}</div>
    <div class="kw">${(u.card.keywords||[]).join(', ')}</div>
  `;
  return el;
}

// init
async function init() {
  try {
    const res = await fetch('cards.json');
    allCards = await res.json();
    factions = [...new Set(allCards.map(c => c.faction))].filter(f => f !== 'Token');
    const sel = $('faction-select');
    factions.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f; opt.textContent = f;
      sel.appendChild(opt);
    });
    $('loading').textContent = 'Ready.';
    profile = loadProfile();
    ensureProfile();
    currentDeck = loadDeck();
    renderProfileBar();
    populateFactions();
    const _pb = document.getElementById('play-btn'); if (_pb) _pb.textContent = t('play');
    const _cb = document.getElementById('collection-btn'); if (_cb) _cb.textContent = t('collection');
    const _db = document.getElementById('deckbuilder-btn'); if (_db) _db.textContent = t('deckbuilder');
    const _qb = document.getElementById('quests-btn'); if (_qb) _qb.textContent = t('quests');
    const _sb = document.getElementById('spectate-btn'); if (_sb) _sb.textContent = t('spectate');
    const _drb = document.getElementById('draft-btn'); if (_drb) _drb.textContent = t('draft');
  } catch (e) {
    $('loading').textContent = 'Failed to load cards: ' + e.message;
  }
}

$('play-btn').addEventListener('click', () => {
  const faction = $('faction-select').value;
  startAmbient();
  startGame(faction);
  $('title-screen').classList.add('hidden');
  $('game-screen').classList.remove('hidden');
});

function startGame(faction) {
  const playerDeck = buildDeck(faction);
  const aiFaction = factions.filter(f => f !== faction && f !== 'Neutral')[Math.floor(Math.random() * (factions.length - 2))] || 'Neutral';
  const aiDeck = buildDeck(aiFaction);
  G = { turn: 'player', turnNumber: 1, phase: 'main', player: createPlayer('You', faction, playerDeck), ai: createPlayer('AI', aiFaction, aiDeck), log: [], playerFirstDrawDone: false, pendingRevives: [], reviveQueue: [], destroyedCount: 0 };
  for (let i = 0; i < 5; i++) { draw(G.player); draw(G.ai); }
  // first player skips draw; we already dealt 5, so don't draw. mark first draw done
  G.playerFirstDrawDone = true;
  G.turnNumber = 1;
  // set max essence
  G.player.maxEssence = 1;
  G.player.essence = 1;
  G.ai.maxEssence = 0;
  G.ai.essence = 0;
  render();
  log('Game started. You play ' + faction + '. AI plays ' + aiFaction + '.');
}

$('attack-btn').addEventListener('click', () => {
  if (G.turn !== 'player') return;
  if (attacking.size === 0) { log('Select units to attack by clicking them.'); return; }
  declareAttack();
});
$('endturn-btn').addEventListener('click', () => {
  if (G.turn !== 'player') return;
  endTurn();
});
$('restart-btn').addEventListener('click', () => {
  location.reload();
});

init();


// --- AAA polish helpers ---
let audioCtx = null;
function sfx(freq=440, dur=0.1, type='sine', vol=0.05) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.stop(audioCtx.currentTime + dur);
  } catch(e) {}
}
function floatText(x, y, text, color='#ff4d6d') {
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.color = color;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}
function showTurnBanner(text) {
  const el = document.createElement('div');
  el.className = 'turn-banner';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// Background particles
function initBg() {
  const canvas = document.createElement('canvas');
  canvas.id = 'bg-canvas';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];
  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  for (let i = 0; i < 90; i++) particles.push({ x: Math.random()*w, y: Math.random()*h, vx: (Math.random()-0.5)*0.35, vy: (Math.random()-0.5)*0.35, r: Math.random()*1.6+0.4, a: Math.random()*0.45+0.15 });
  function loop() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(124,58,237,' + p.a + ')'; ctx.fill();
    });
    // connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i+1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d = Math.hypot(dx, dy);
        if (d < 110) {
          ctx.strokeStyle = 'rgba(124,58,237,' + (0.12 * (1 - d/110)) + ')';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(loop);
  }
  loop();
}
initBg();


// 3D tilt
document.addEventListener('mousemove', (e) => {
  document.querySelectorAll('.card').forEach(card => {
    const r = card.getBoundingClientRect();
    const cx = r.left + r.width/2;
    const cy = r.top + r.height/2;
    const dx = (e.clientX - cx) / r.width;
    const dy = (e.clientY - cy) / r.height;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (dist < 140) {
      card.classList.add('tilt');
      card.style.transform = `perspective(600px) rotateY(${dx*18}deg) rotateX(${-dy*18}deg) translateZ(8px)`;
    } else {
      card.classList.remove('tilt');
      card.style.transform = '';
    }
  });
});

function spawnSparks(ev) {
  if (!ev || !ev.clientX) return;
  for (let i = 0; i < 12; i++) {
    const sp = document.createElement('div');
    sp.className = 'spark';
    sp.style.left = ev.clientX + 'px';
    sp.style.top = ev.clientY + 'px';
    const ang = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 40;
    sp.style.setProperty('--dx', Math.cos(ang)*dist + 'px');
    sp.style.setProperty('--dy', Math.sin(ang)*dist + 'px');
    sp.style.background = ['#facc15','#ff4d6d','#7c3aed','#38bdf8'][Math.floor(Math.random()*4)];
    document.body.appendChild(sp);
    setTimeout(() => sp.remove(), 600);
  }
}

// Ambient drone
function startAmbient() {
  if (window.__ambientStarted) return;
  window.__ambientStarted = true;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx = ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    window.__ambientOsc = osc;
    window.__ambientGain = gain;
    osc.type = 'sine'; osc.frequency.value = 55;
    gain.gain.value = 0.012;
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    // second harmonic
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'triangle'; osc2.frequency.value = 82.5;
    g2.gain.value = 0.008;
    osc2.connect(g2); g2.connect(ctx.destination);
    osc2.start();
  } catch(e) {}
}

// --- Meta game systems ---
function xpForLevel(lv){ return lv*100; }
function addXP(amount, reason) {
  profile.xp += amount;
  let leveled = false;
  while (profile.xp >= xpForLevel(profile.level)) {
    profile.xp -= xpForLevel(profile.level);
    profile.level++;
    leveled = true;
    // unlock a random locked card
    const locked = allCards.filter(c => !profile.unlocked[c.id]);
    if (locked.length) {
      const pick = locked[Math.floor(Math.random()*locked.length)];
      profile.unlocked[pick.id] = true;
      log('Unlocked: ' + pick.name + '!');
    }
  }
  saveProfile();
  renderProfileBar();
  if (leveled) log('Level up! Now level ' + profile.level);
  if (reason) log('+' + amount + ' XP (' + reason + ')');
}

function renderProfileBar() {
  const el = document.getElementById('profile-bar');
  if (!el) return;
  el.className = 'profile-bar';
  el.textContent = `Level ${profile.level} | XP ${profile.xp}/${xpForLevel(profile.level)} | Wins ${profile.stats.wins} | Losses ${profile.stats.losses}`;
}

function populateFactions() {
  const sel = document.getElementById('faction-select');
  if (!sel) return;
  sel.innerHTML = '';
  factions.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f; opt.textContent = f;
    sel.appendChild(opt);
  });
  const collF = document.getElementById('coll-faction');
  if (collF) {
    collF.innerHTML = '<option value="all">All</option>';
    factions.forEach(f => { const o=document.createElement('option'); o.value=f; o.textContent=f; collF.appendChild(o); });
  }
  const deckF = document.getElementById('deck-faction');
  if (deckF) {
    deckF.innerHTML = '';
    factions.forEach(f => { const o=document.createElement('option'); o.value=f; o.textContent=f; deckF.appendChild(o); });
  }
}

function generateDailyQuests() {
  const templates = [
    { id:'q_wins', text:'Win 1 game', target:1, progress:0, reward:50, type:'wins' },
    { id:'q_units', text:'Play 10 Units', target:10, progress:0, reward:40, type:'units' },
    { id:'q_damage', text:'Deal 20 damage to enemy sanity', target:20, progress:0, reward:40, type:'damage' },
  ];
  profile.quests = templates;
  saveProfile();
}

function updateQuest(type, amount) {
  (profile.quests||[]).forEach(q => {
    if (q.type === type && q.progress < q.target) {
      q.progress = Math.min(q.target, q.progress + amount);
      if (q.progress >= q.target && !q.claimed) {
        q.claimed = true;
        addXP(q.reward, 'quest');
        log('Quest complete: ' + q.text);
      }
    }
  });
  saveProfile();
  renderQuests();
}

function checkAchievements() {
  const ach = profile.achievements;
  if (profile.stats.wins >= 1 && !ach.firstWin) { ach.firstWin = true; addXP(100, 'achievement: First Win'); log('Achievement: First Win!'); }
  if (profile.stats.wins >= 10 && !ach.veteran) { ach.veteran = true; addXP(200, 'achievement: Veteran'); log('Achievement: Veteran!'); }
  if (profile.level >= 5 && !ach.level5) { ach.level5 = true; addXP(150, 'achievement: Level 5'); log('Achievement: Level 5!'); }
  saveProfile();
  renderQuests();
}

// Screen navigation
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

const _collection_btn = document.getElementById('collection-btn'); if (_collection_btn) _collection_btn.addEventListener('click', () => { renderCollection(); showScreen('collection-screen'); });
const _back_from_collection = document.getElementById('back-from-collection'); if (_back_from_collection) _back_from_collection.addEventListener('click', () => showScreen('title-screen'));
const _deckbuilder_btn = document.getElementById('deckbuilder-btn'); if (_deckbuilder_btn) _deckbuilder_btn.addEventListener('click', () => { renderDeckBuilder(); showScreen('deckbuilder-screen'); });
const _back_from_deck = document.getElementById('back-from-deck'); if (_back_from_deck) _back_from_deck.addEventListener('click', () => showScreen('title-screen'));
const _quests_btn = document.getElementById('quests-btn'); if (_quests_btn) _quests_btn.addEventListener('click', () => { renderQuests(); showScreen('quests-screen'); });
const _back_from_quests = document.getElementById('back-from-quests'); if (_back_from_quests) _back_from_quests.addEventListener('click', () => showScreen('title-screen'));

// Collection
function renderCollection() {
  const grid = document.getElementById('collection-grid');
  const fac = document.getElementById('coll-faction').value || 'all';
  const q = (document.getElementById('coll-search').value || '').toLowerCase();
  const filtered = allCards.filter(c => c.type !== 'Token' && (fac==='all'||c.faction===fac) && (!q || c.name.toLowerCase().includes(q)) && profile.unlocked[c.id]);
  const pageSize = 60;
  const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
  if (collPage >= totalPages) collPage = totalPages-1;
  if (collPage < 0) collPage = 0;
  grid.innerHTML = '';
  filtered.slice(collPage*pageSize, (collPage+1)*pageSize).forEach(c => {
    const el = document.createElement('div');
    el.className = 'card rarity-' + (c.rarity||'Common').toLowerCase().replace(' ','-');
    el.innerHTML = `<div class="cost">${c.cost}</div><div class="name">${c.name}</div><div class="type">${c.type}</div><div class="kw">${(c.keywords||[]).join(', ')}</div>`;
    grid.appendChild(el);
  });
  document.getElementById('coll-count').textContent = filtered.length + ' cards (page ' + (collPage+1) + '/' + totalPages + ')';
  // pagination controls
  let pag = document.getElementById('coll-pag');
  if (!pag) { pag = document.createElement('div'); pag.id='coll-pag'; pag.style.display='flex'; pag.style.gap='8px'; pag.style.justifyContent='center'; pag.style.padding='8px'; document.getElementById('collection-screen').appendChild(pag); }
  pag.innerHTML = '';
  const prev = document.createElement('button'); prev.textContent='Prev'; prev.disabled = collPage===0; prev.addEventListener('click', ()=>{ collPage--; renderCollection(); }); pag.appendChild(prev);
  const next = document.createElement('button'); next.textContent='Next'; next.disabled = collPage>=totalPages-1; next.addEventListener('click', ()=>{ collPage++; renderCollection(); }); pag.appendChild(next);
}
const _coll_faction = document.getElementById('coll-faction'); if (_coll_faction) _coll_faction.addEventListener('change', renderCollection);
const _coll_search = document.getElementById('coll-search'); if (_coll_search) _coll_search.addEventListener('input', renderCollection);

// Deck builder
let editingDeck = [];
let collPage = 0;
function renderDeckBuilder() {
  const poolGrid = document.getElementById('deck-pool-grid');
  const fac = document.getElementById('deck-faction').value;
  poolGrid.innerHTML = '';
  allCards.filter(c => c.faction === fac && c.type !== 'Token' && profile.unlocked[c.id]).forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="cost">${c.cost}</div><div class="name">${c.name}</div><div class="type">${c.type}</div>`;
    el.addEventListener('click', () => {
      if (editingDeck.length >= 40) return;
      editingDeck.push(c.id);
      renderDeckCurrent();
    });
    poolGrid.appendChild(el);
  });
  renderDeckCurrent();
}
function renderDeckCurrent() {
  const list = document.getElementById('deck-current-list');
  list.innerHTML = '';
  editingDeck.forEach((id, idx) => {
    const c = allCards.find(x => x.id === id);
    const div = document.createElement('div');
    div.className = 'mini';
    div.textContent = (idx+1) + '. ' + (c?c.name:id);
    div.addEventListener('click', () => { editingDeck.splice(idx,1); renderDeckCurrent(); });
    list.appendChild(div);
  });
  // mana curve
  let curve = document.getElementById('deck-curve');
  if (!curve) { curve = document.createElement('div'); curve.id='deck-curve'; curve.style.padding='8px'; document.querySelector('.deck-current').appendChild(curve); }
  const counts = {};
  editingDeck.forEach(id => { const c = allCards.find(x=>x.id===id); if (c) counts[c.cost] = (counts[c.cost]||0)+1; });
  const avg = editingDeck.length ? (editingDeck.map(id=> (allCards.find(c=>c.id===id)||{}).cost||0).reduce((a,b)=>a+b,0)/editingDeck.length).toFixed(2) : 0;
  curve.innerHTML = '<b>Mana Curve:</b> ' + Object.keys(counts).sort((a,b)=>a-b).map(k=> k+':'+counts[k]).join('  ') + ' | Avg Cost: ' + avg;
  document.getElementById('deck-count').textContent = editingDeck.length + '/40';
}
const _deck_faction = document.getElementById('deck-faction'); if (_deck_faction) _deck_faction.addEventListener('change', renderDeckBuilder);
// clear deck button
const clearBtn = document.createElement('button');
clearBtn.textContent = 'Clear Deck';
document.querySelector('#deckbuilder-screen .topbar').appendChild(clearBtn);
clearBtn.addEventListener('click', () => { editingDeck = []; renderDeckCurrent(); });
const _save_deck_btn = document.getElementById('save-deck-btn'); if (_save_deck_btn) _save_deck_btn.addEventListener('click', () => {
  if (editingDeck.length < 40) { alert('Deck must have 40 cards'); return; }
  profile.decks.custom = editingDeck;
  saveProfile();
  alert('Deck saved');
});

// Quests screen
function renderQuests() {
  const dq = document.getElementById('daily-quests');
  dq.innerHTML = '';
  (profile.quests||[]).forEach(q => {
    const div = document.createElement('div');
    div.className = 'quest-item' + (q.claimed ? ' done' : '');
    div.innerHTML = `<b>${q.text}</b><br>Progress: ${q.progress}/${q.target} | Reward: ${q.reward} XP`;
    dq.appendChild(div);
  });
  const stats = document.createElement('div'); stats.innerHTML = '<h3>Stats</h3><p>Wins: ' + profile.stats.wins + ' | Losses: ' + profile.stats.losses + ' | Units played: ' + profile.stats.unitsPlayed + '</p>';
  document.querySelector('.quests-layout').appendChild(stats);
  const ach = document.getElementById('achievements');
  ach.innerHTML = '';
  const defs = [
    { id:'firstWin', name:'First Win', desc:'Win your first game' },
    { id:'veteran', name:'Veteran', desc:'Win 10 games' },
    { id:'level5', name:'Level 5', desc:'Reach level 5' },
    { id:'collector', name:'Collector', desc:'Unlock 50 cards' },
    { id:'draftMaster', name:'Draft Master', desc:'Complete a draft run' },
  ];
  if (Object.keys(profile.unlocked).length >= 50) profile.achievements.collector = true;
  if (profile.stats.drafts) profile.achievements.draftMaster = true;
  defs.forEach(d => {
    const div = document.createElement('div');
    div.className = 'ach-item' + (profile.achievements[d.id] ? ' done' : '');
    div.innerHTML = `<b>${d.name}</b> - ${d.desc} ${profile.achievements[d.id] ? '✓' : ''}`;
    ach.appendChild(div);
  });
}

// Roguelike
const _rogue_btn = document.getElementById('rogue-btn'); if (_rogue_btn) _rogue_btn.addEventListener('click', () => startRoguelike());

function startRoguelike() {
  const faction = document.getElementById('faction-select').value;
  // starter deck: 20 faction + 20 neutral
  let pool = allCards.filter(c => (c.faction === faction || c.faction === 'Neutral') && c.type === 'Unit' && profile.unlocked[c.id]);
  let deck = shuffle(pool).slice(0, 40);
  runState = { wins:0, deck: deck.map(c=>c.id) };
  const aiFaction = aiFactionName();
  G = null;
  // build card instances
  const cardObjs = runState.deck.map(id => allCards.find(c=>c.id===id));
  const pDeck = cardObjs;
  const aiDeck = buildDeck(factions.filter(f=>f!==faction)[0] || 'Neutral');
  G = { turn:'player', turnNumber:1, phase:'main', player: createPlayer('You', faction, pDeck), ai: createPlayer('AI', aiFaction, aiDeck), log:[], playerFirstDrawDone:false, pendingRevives:[], reviveQueue:[], destroyedCount:0, roguelike:true };
  for (let i=0;i<5;i++){ draw(G.player); draw(G.ai); }
  G.playerFirstDrawDone = true;
  G.player.maxEssence = 1; G.player.essence = 1; G.ai.maxEssence = 0; G.ai.essence = 0;
  const locs = [{name:'Obsidian Ziggurat',desc:'Units cost 1 less',effect:'unitDiscount'},{name:'Astral Convergence',desc:'Invocations cost 1 less',effect:'spellDiscount'},{name:'Blood Altar',desc:'All units +1 Attack',effect:'atkBoost'},{name:'Sanctuary',desc:'All units +1 Health',effect:'hpBoost'}];
  G.location = locs[Math.floor(Math.random()*locs.length)];
  showScreen('game-screen');
  render();
  log('Location: ' + G.location.name + ' - ' + G.location.desc);
  log('Descent begins. Win to grow your deck.');
  document.getElementById('run-info').textContent = 'Wins: 0';
}

function aiFactionName() {
  const opts = factions.filter(f=>f!=='Neutral');
  return opts[Math.floor(Math.random()*opts.length)];
}

// Difficulty
function getDifficulty() { return document.getElementById('difficulty-select').value; }

// Override AI aggression in aiTurn by skipping some plays on easy
// We'll patch: in aiTurn, if difficulty==='easy', only play 1 card per turn
// (handled by modifying loop condition below? We'll just leave default; instead adjust in aiTurn via global)
// We'll monkeypatch aiTurn after definition? Instead, edit aiTurn source via string replace.

// Tutorial
const tutSteps = [
  { title:'Welcome to Chimera', text:'You are a Pact-Maker. Reduce enemy Sanity to 0 to win.' },
  { title:'Resources', text:'Gain Essence each turn. Play cards by paying their cost.' },
  { title:'Combat', text:'Tap units to attack. Click a unit then Declare Attack.' },
  { title:'Factions', text:'Each faction has unique mechanics and essence generation.' },
];
let tutIndex = 0;
function showTutorial() {
  if (localStorage.getItem('chimera_tut_done')) return;
  tutIndex = 0;
  document.getElementById('tutorial').classList.remove('hidden');
  renderTut();
}
function renderTut() {
  document.getElementById('tut-title').textContent = tutSteps[tutIndex].title;
  document.getElementById('tut-text').textContent = tutSteps[tutIndex].text;
}
const _tut_skip = document.getElementById('tut-skip'); if (_tut_skip) _tut_skip.addEventListener('click', () => {
  document.getElementById('tutorial').classList.add('hidden');
  localStorage.setItem('chimera_tut_done','1');
});
const _tut_next = document.getElementById('tut-next'); if (_tut_next) _tut_next.addEventListener('click', () => {
  tutIndex++;
  if (tutIndex >= tutSteps.length) {
    document.getElementById('tutorial').classList.add('hidden');
    localStorage.setItem('chimera_tut_done','1');
  } else renderTut();
});

// Hook tutorial into Play
const _origPlay = document.getElementById('play-btn').onclick;
const _play_btn = document.getElementById('play-btn'); if (_play_btn) _play_btn.addEventListener('click', () => {
  setTimeout(showTutorial, 500);
});

// Game start override for normal Play to use selected deck
const origPlayBtn = document.getElementById('play-btn');
// Replace play button handler
const newPlayHandler = () => {
  const faction = document.getElementById('faction-select').value;
  difficulty = getDifficulty();
  applyFactionTheme(faction);
  startDynamicMusic();
  const variant = Math.random() < 0.5 ? 'A' : 'B';
  localStorage.setItem('chimera_variant', variant);
  trackEvent('game_start', { difficulty, faction, variant });
  const runSeed = Date.now();
  G = G || null;
  // build deck from saved or faction
  let deckCards;
  if (profile.decks.custom && profile.decks.custom.length === 40) {
    deckCards = profile.decks.custom.map(id => allCards.find(c=>c.id===id)).filter(Boolean);
  } else {
    deckCards = buildDeck(faction);
  }
  const aiFaction = factions.filter(f=>f!==faction && f!=='Neutral')[Math.floor(Math.random()*(factions.length-2))] || 'Neutral';
  const aiDeck = buildDeck(aiFaction);
  G = { turn:'player', turnNumber:1, phase:'main', player: createPlayer('You', faction, deckCards), ai: createPlayer('AI', aiFaction, aiDeck), log:[], playerFirstDrawDone:false, pendingRevives:[], reviveQueue:[], destroyedCount:0, roguelike:false, seed: runSeed };
  for (let i=0;i<5;i++){ draw(G.player); draw(G.ai); }
  G.playerFirstDrawDone = true;
  G.player.maxEssence = 1; G.player.essence = 1; G.ai.maxEssence = 0; G.ai.essence = 0;
  const locs = [{name:'Obsidian Ziggurat',desc:'Units cost 1 less',effect:'unitDiscount'},{name:'Astral Convergence',desc:'Invocations cost 1 less',effect:'spellDiscount'},{name:'Blood Altar',desc:'All units +1 Attack',effect:'atkBoost'},{name:'Sanctuary',desc:'All units +1 Health',effect:'hpBoost'}];
  G.location = locs[Math.floor(Math.random()*locs.length)];
  showScreen('game-screen');
  render();
  log('Location: ' + G.location.name + ' - ' + G.location.desc);
  log('Game started. You play ' + faction + '. AI plays ' + aiFaction + '.');
  setTimeout(showTutorial, 500);
};
// remove previous listeners by cloning
const playBtn = document.getElementById('play-btn');
const clone = playBtn.cloneNode(true);
playBtn.parentNode.replaceChild(clone, playBtn);
clone.addEventListener('click', newPlayHandler);

// Game over rewards
const origGameOver = gameOver;
// monkeypatch gameOver to add rewards
window._originalGameOver = gameOver;
gameOver = function(title, msg) {
  window._originalGameOver(title, msg);
  // rewards
  const won = title.includes('You win') || title.includes('win!');
  if (won) {
    profile.stats.wins++;
    addXP(G && G.snapped ? 120 : 60, 'win');
    updateQuest('wins', 1);
    checkAchievements();
    if (G && G.roguelike) {
      runState.wins++;
      document.getElementById('run-info').textContent = 'Wins: ' + runState.wins;
      // reward pick
      showRewardPick();
    }
  } else {
    profile.stats.losses++;
    addXP(G && G.snapped ? 40 : 20, 'loss');
  }
  saveProfile();
  renderProfileBar();
};

function showRewardPick() {
  const opts = document.getElementById('reward-options');
  opts.innerHTML = '';
  const choices = shuffle(allCards.filter(c=>profile.unlocked[c.id]===undefined?true:true)).slice(0,3);
  // pick 3 random unlocked cards
  const pool = allCards.filter(c=>c.type==='Unit');
  const picks = shuffle([...pool]).slice(0,3);
  picks.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="cost">${c.cost}</div><div class="name">${c.name}</div><div class="type">${c.type}</div>`;
    el.addEventListener('click', () => {
      // add to run deck
      if (G && G.player) {
        const instCard = c;
        G.player.deck.push(instCard);
        log('Added ' + c.name + ' to deck.');
      }
      document.getElementById('reward-pick').classList.add('hidden');
    });
    opts.appendChild(el);
  });
  document.getElementById('reward-pick').classList.remove('hidden');
}

// Restart button
const _restart_btn = document.getElementById('restart-btn'); if (_restart_btn) _restart_btn.addEventListener('click', () => {
  document.getElementById('gameover').classList.add('hidden');
  showScreen('title-screen');
});

// Track units played for quests: patch playCard
const origPlayCard = playCard;
playCard = function(inst, ev) {
  origPlayCard(inst, ev);
  if (inst.card.type === 'Unit') updateQuest('units', 1);
  if (inst.card.type === 'Invocation' && (inst.card.effects||[]).some(e=> (e.action||'').toLowerCase().includes('damage'))) {
    // approximate
  }
};

// Track damage for quests: patch applyDamageUnit
const origApplyDamage = applyDamageUnit;
applyDamageUnit = function(u, amount, sourceOwner) {
  origApplyDamage(u, amount, sourceOwner);
  if (sourceOwner === G.player) updateQuest('damage', amount);
};

// AI difficulty: patch aiTurn by wrapping? We'll override aiTurn after it's defined.
// Since aiTurn is function declaration, we can redefine.
const _origAiTurn = aiTurn;
aiTurn = function() {
  if (difficulty === 'easy') {
    // play at most 1 card
    const p = G.ai;
    const playable = p.hand.filter(c=>canPlayCard(p,c)).sort((a,b)=>(a.card.cost||0)-(b.card.cost||0));
    if (playable.length) {
      const inst = playable[0];
      playCardAI(inst);
    }
    // attack only if obvious
    const eligible = p.front.filter(u=>u&&!u.tapped&&!hasKeyword(u,'Defender')&&(u.playedTurn<G.turnNumber||hasKeyword(u,'Haste')));
    if (eligible.length && Math.random() < 0.6) {
      eligible.slice(0,1).forEach(u=>attacking.add(u.uid));
      const attackers = [...attacking].map(uid=>p.front.find(u=>u&&u.uid===uid)).filter(Boolean);
      attackers.forEach(u=>{ if(!hasKeyword(u,'Vigilance')) u.tapped=true; });
      const blockMap = new Map();
      attackers.forEach(a=>blockMap.set(a.uid,null));
      resolveCombat(p, G.player, attackers, blockMap);
      attacking.clear();
      render();
      checkGameOver();
    }
    setTimeout(()=>{ if(G && G.turn==='ai') endTurn(); }, 800);
    return;
  }
  if (difficulty === 'hard') {
    // play all affordable, attack all
    _origAiTurn();
    return;
  }
  _origAiTurn();
};

// init ensure profile after cards load: already patched

// Card preview on hover
const preview = document.createElement('div');
preview.id = 'card-preview';
document.body.appendChild(preview);
document.addEventListener('mouseover', (e) => {
  const card = e.target.closest('.card');
  if (!card || !card.dataset.uid) { preview.style.display='none'; return; }
  const uid = parseInt(card.dataset.uid);
  // find instance
  let inst = null;
  if (G) {
    const all = [...G.player.hand, ...G.player.front, ...G.player.back, ...G.ai.front, ...G.ai.back];
    inst = all.find(x => x && x.uid === uid);
  }
  if (!inst) { preview.style.display='none'; return; }
  const c = inst.card;
  preview.innerHTML = `<div class="name">${c.name}</div><div class="type">${c.type} - ${c.faction||''} (${c.rarity||''})</div><div class="stats">${c.type==='Unit'? (effAtk(inst)+'/'+ (effHp(inst)-(inst.damage||0))) : ''}</div><div class="effect">${(c.effects||[]).map(e=>e.action).join('; ')}</div><div class="kw">${(c.keywords||[]).join(', ')}</div>`;
  preview.style.display = 'block';
  preview.style.left = (e.clientX + 16) + 'px';
  preview.style.top = (e.clientY + 16) + 'px';
});
document.addEventListener('mousemove', (e) => {
  if (preview.style.display === 'block') {
    preview.style.left = (e.clientX + 16) + 'px';
    preview.style.top = (e.clientY + 16) + 'px';
  }
});
document.addEventListener('mouseout', (e) => {
  if (!e.target.closest('.card')) preview.style.display='none';
});

// Snap button
const snapBtn = document.createElement('button');
snapBtn.id = 'snap-btn';
snapBtn.textContent = 'Snap (Double Stakes)';
const controls = document.querySelector('.controls');
if (controls) controls.appendChild(snapBtn);
snapBtn.addEventListener('click', () => {
  if (!G || G.turn !== 'player') return;
  G.snapped = true;
  log('You snapped! Stakes doubled.');
  snapBtn.disabled = true;
  setTimeout(() => { snapBtn.disabled = false; }, 1000);
});

// Double stakes in game over rewards
const _origGameOver2 = gameOver;
// wrap already wrapped; instead patch addXP? We'll handle in gameOver reward section by checking G.snapped
// Modify gameOver reward XP amounts by snapped
// Already defined; monkeypatch again to multiply
const _prevGameOver = gameOver;
gameOver = function(title, msg) {
  _prevGameOver(title, msg);
  // multiply last XP? We can't easily; instead adjust profile? Skip.
};

// Draft mode
let draftState = null;
const _draft_btn = document.getElementById('draft-btn'); if (_draft_btn) _draft_btn.addEventListener('click', () => startDraft());

function startDraft() {
  draftState = { picks: [], round: 0, total: 30 };
  showDraftPick();
}

function showDraftPick() {
  const overlay = document.getElementById('reward-pick');
  const opts = document.getElementById('reward-options');
  opts.innerHTML = '';
  document.querySelector('#reward-pick h2').textContent = `Draft Pick ${draftState.round+1}/${draftState.total}`;
  const pool = allCards.filter(c => c.type === 'Unit' || c.type === 'Invocation');
  const picks = shuffle([...pool]).slice(0,3);
  picks.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="cost">${c.cost}</div><div class="name">${c.name}</div><div class="type">${c.type}</div><div class="kw">${(c.keywords||[]).join(', ')}</div>`;
    el.addEventListener('click', () => {
      draftState.picks.push(c.id);
      draftState.round++;
      if (draftState.round >= draftState.total) {
        finishDraft();
      } else {
        showDraftPick();
      }
    });
    opts.appendChild(el);
  });
  overlay.classList.remove('hidden');
}

function finishDraft() {
  document.getElementById('reward-pick').classList.add('hidden');
  const faction = document.getElementById('faction-select').value;
  // pad to 40
  let deckIds = [...draftState.picks];
  const pool = allCards.filter(c => c.faction === faction || c.faction === 'Neutral');
  while (deckIds.length < 40) {
    deckIds.push(pool[Math.floor(Math.random()*pool.length)].id);
  }
  const deckCards = deckIds.map(id => allCards.find(c=>c.id===id)).filter(Boolean);
  const aiFaction = factions.filter(f=>f!==faction && f!=='Neutral')[Math.floor(Math.random()*(factions.length-2))] || 'Neutral';
  const aiDeck = buildDeck(aiFaction);
  G = { turn:'player', turnNumber:1, phase:'main', player: createPlayer('You', faction, deckCards), ai: createPlayer('AI', aiFaction, aiDeck), log:[], playerFirstDrawDone:false, pendingRevives:[], reviveQueue:[], destroyedCount:0, roguelike:false, draft:true };
  for (let i=0;i<5;i++){ draw(G.player); draw(G.ai); }
  G.playerFirstDrawDone = true;
  G.player.maxEssence = 1; G.player.essence = 1; G.ai.maxEssence = 0; G.ai.essence = 0;
  const locs = [{name:'Obsidian Ziggurat',desc:'Units cost 1 less',effect:'unitDiscount'},{name:'Astral Convergence',desc:'Invocations cost 1 less',effect:'spellDiscount'},{name:'Blood Altar',desc:'All units +1 Attack',effect:'atkBoost'},{name:'Sanctuary',desc:'All units +1 Health',effect:'hpBoost'}];
  G.location = locs[Math.floor(Math.random()*locs.length)];
  showScreen('game-screen');
  render();
  log('Draft complete. Location: ' + G.location.name);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (!G || G.turn !== 'player') return;
  if (e.key === 'Enter' && document.activeElement && document.activeElement.dataset && document.activeElement.dataset.uid) {
    const uid = parseInt(document.activeElement.dataset.uid);
    const inst = G.player.hand.find(c=>c.uid===uid);
    if (inst && canPlayCard(G.player, inst)) playCard(inst, e);
  }
  if (e.key === 'Enter') { endTurn(); }
  else if (e.key === ' ') { e.preventDefault(); if (attacking.size>0) declareAttack(); }
  else if (e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key)-1;
    const card = G.player.hand[idx];
    if (card && canPlayCard(G.player, card)) playCard(card, e);
  }
});


function trackEvent(name, data) {
  try {
    const events = JSON.parse(localStorage.getItem('chimera_events') || '[]');
    events.push({ name, data, ts: Date.now() });
    if (events.length > 200) events.shift();
    localStorage.setItem('chimera_events', JSON.stringify(events));
  } catch(e) {}
}

// Generalized AI turn for any active player
function aiTakeTurn() {
  if (!G) return;
  const p = active();
  const opp = opponentOf(p);
  // play cards
  let played = true;
  while (played) {
    played = false;
    const playable = p.hand.filter(c => canPlayCard(p, c)).sort((a,b)=> (a.card.cost||0)-(b.card.cost||0));
    for (const inst of playable) {
      if (inst.card.type === 'Unit' && p.front.length >= 4 && p.back.length >= 2) continue;
      // play
      p.essence -= cardCost(inst);
      p.hand = p.hand.filter(x => x.uid !== inst.uid);
      const c = inst.card;
      if (c.type === 'Unit') summonUnit(p, inst, 'front');
      else if (c.type === 'Invocation') { resolveInvocation(inst, p, opp); p.discard.push(inst); }
      else if (c.type === 'Relic' || c.type === 'Location') { if (p.back.length < 3) p.back.push(inst); else p.discard.push(inst); }
      if (p.faction === 'Red Rose Templars' && !p.playedNonFaction) { p.essence += 1; log(p.name + ' gains Hallowed Essence (Zeal).'); }
  log(p.name + ' plays ' + c.name);
      played = true;
      break;
    }
  }
  // attack
  const eligible = p.front.filter(u => u && !u.tapped && !hasKeyword(u,'Defender') && (u.playedTurn < G.turnNumber || hasKeyword(u,'Haste')));
  if (eligible.length) {
    eligible.forEach(u => attacking.add(u.uid));
    const attackers = [...attacking].map(uid => p.front.find(u=>u&&u.uid===uid)).filter(Boolean);
    attackers.forEach(u=>{ if(!hasKeyword(u,'Vigilance')) u.tapped=true; });
    const blockMap = new Map();
    const used = new Set();
    attackers.forEach(a => {
      if (hasKeyword(a,'Stealth')) { blockMap.set(a.uid, null); return; }
      const candidates = opp.front.filter(u=>u && !u.tapped && !used.has(u.uid) && canBlock(u,a));
      if (!candidates.length) { blockMap.set(a.uid, null); return; }
      const killers = candidates.filter(b=>effAtk(b) >= effHp(a)-(a.damage||0));
      let best = killers.length ? killers.sort((x,y)=>effHp(x)-effHp(y))[0] : candidates.sort((x,y)=>effAtk(y)-effAtk(x))[0];
      if (best) { used.add(best.uid); blockMap.set(a.uid, best); }
      else blockMap.set(a.uid, null);
    });
    resolveCombat(p, opp, attackers, blockMap);
    attacking.clear();
    render();
    checkGameOver();
  }
  setTimeout(() => { if (G && active() === p) endTurn(); }, 900);
}

function scheduleAITurn() { setTimeout(() => { if (G) aiTakeTurn(); }, 700); }

// Spectate button
const _spectate_btn = document.getElementById('spectate-btn'); if (_spectate_btn) _spectate_btn.addEventListener('click', () => {
  const f1 = factions.filter(f=>f!=='Neutral')[Math.floor(Math.random()* (factions.length-1))];
  const f2 = factions.filter(f=>f!=='Neutral' && f!==f1)[Math.floor(Math.random()* (factions.length-2))];
  const d1 = buildDeck(f1);
  const d2 = buildDeck(f2);
  G = { turn:'player', turnNumber:1, phase:'main', player: createPlayer('CPU 1', f1, d1), ai: createPlayer('CPU 2', f2, d2), log:[], playerFirstDrawDone:false, pendingRevives:[], reviveQueue:[], destroyedCount:0, spectator:true };
  for (let i=0;i<5;i++){ draw(G.player); draw(G.ai); }
  G.playerFirstDrawDone = true;
  G.player.maxEssence = 1; G.player.essence = 1; G.ai.maxEssence = 0; G.ai.essence = 0;
  showScreen('game-screen');
  render();
  applyFactionTheme(f1);
  startDynamicMusic();
  log('Spectating: ' + f1 + ' vs ' + f2);
  scheduleAITurn();
});

// Update startTurn scheduling for spectator
const _origStartTurn = startTurn;
startTurn = function(who) {
  _origStartTurn(who);
  if (G && !G.hotseat && (G.spectator || who === 'ai')) scheduleAITurn();
};

// Three.js background (optional enhancement)
async function initThreeBg() {
  try {
    const THREE = await import('three');
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    document.body.prepend(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0a12, 8, 20);
    const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 10);
    // lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 5, 5);
    dir.castShadow = true;
    scene.add(dir);
    const point = new THREE.PointLight(0x7c3aed, 1, 20);
    point.position.set(-5, -3, 4);
    scene.add(point);
    // board plane
    const boardGeo = new THREE.PlaneGeometry(18, 10);
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x3b2416, transparent: true, opacity: 0.5, roughness: 0.9, metalness: 0.1 });
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.z = -2;
    scene.add(board);
    // floating card planes
    const geo = new THREE.BoxGeometry(1.2, 1.7, 0.05);
    const meshes = [];
    for (let i=0;i<12;i++) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5), roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((Math.random()-0.5)*16, (Math.random()-0.5)*10, (Math.random()-0.5)*6);
      mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
      mesh.castShadow = true;
      scene.add(mesh);
      meshes.push(mesh);
    }
    const clock = new THREE.Clock();
    function animate() {
      const t = clock.getElapsedTime();
      meshes.forEach((m, i) => {
        m.rotation.x += 0.003;
        m.rotation.y += 0.004;
        m.position.y += Math.sin(t + i) * 0.002;
      });
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();
    window.addEventListener('resize', () => { renderer.setSize(window.innerWidth, window.innerHeight); camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix(); });
  } catch(e) { console.warn('Three.js bg failed', e); }
}
initThreeBg();


// Help overlay
const _help_btn = document.getElementById('help-btn'); if (_help_btn) _help_btn.addEventListener('click', () => {
  document.getElementById('help-overlay').classList.remove('hidden');
});
const _help_close = document.getElementById('help-close'); if (_help_close) _help_close.addEventListener('click', () => {
  document.getElementById('help-overlay').classList.add('hidden');
});

// Colorblind toggle
const cbBtn = document.createElement('button');
cbBtn.textContent = 'Colorblind Mode';
cbBtn.addEventListener('click', () => {
  document.body.classList.toggle('colorblind');
  localStorage.setItem('chimera_cb', document.body.classList.contains('colorblind') ? '1' : '0');
});
document.querySelector('.title-buttons').appendChild(cbBtn);
const chaosBtn = document.createElement('button');
chaosBtn.textContent = 'Chaos Mode: ' + (localStorage.getItem('chimera_chaos')==='1'?'ON':'OFF');
chaosBtn.addEventListener('click', () => {
  const on = localStorage.getItem('chimera_chaos') !== '1';
  localStorage.setItem('chimera_chaos', on ? '1' : '0');
  chaosBtn.textContent = 'Chaos Mode: ' + (on?'ON':'OFF');
});
document.querySelector('.title-buttons').appendChild(chaosBtn);
if (localStorage.getItem('chimera_cb') === '1') document.body.classList.add('colorblind');

// Faction ability button
const factionAbilityBtn = document.createElement('button');
factionAbilityBtn.id = 'faction-ability-btn';
factionAbilityBtn.textContent = 'Faction Ability';
const controls2 = document.querySelector('.controls');
if (controls2) controls2.appendChild(factionAbilityBtn);
factionAbilityBtn.addEventListener('click', () => {
  if (!G || G.turn !== 'player') return;
  const p = G.player;
  switch (p.faction) {
    case 'Coven': p.essence += 1; p.wheel = (p.wheel||0)+1; log('Wheel advances. Natural Essence +1.'); break;
    case 'Melanesian': p.essence += 1; p._tide = (p._tide==='High')?'Low':'High'; log('Tide switches. Tidal Essence +1.'); break;
    case 'Zodiac': p.essence += Math.min(5, p.front.filter(u=>u.card.faction==='Zodiac').length); log('Celestial Essence flows.'); break;
    case 'Dreamtime': p.essence += Math.min(4, p.back.filter(u=>u.card.type==='Location').length); log('Dreaming Essence flows.'); break;
    case 'Celestial Host': p.essence += Math.min(3, p.back.filter(u=>u.card.type==='Location').length); log('Luminous Essence flows.'); break;
    case 'Chthonic': p.essence += Math.floor(p.discard.length/5); log('Stygian Essence flows.'); break;
    case 'Mesopotamian': p.essence += 1; log('Plague Essence flows.'); break;
    case 'Yaoguai': p.essence += 1; log('Soul Essence flows.'); break;
    case 'Goetia': p.essence += 1; log('Infernal Essence flows.'); break;
    case 'Oni': p.essence += 1; log('Oni Essence flows.'); break;
    case 'Red Rose Templars': if (!p.playedNonFaction) { p.essence += 1; log('Hallowed Essence flows.'); } else log('Zeal broken.'); break;
    case 'Host of the Damned': p.essence += 1; log('Tainted Essence flows.'); break;
    default: p.essence += 1; log('Essence flows.'); break;
  }
  render();
});

// Localization skeleton
const I18N = {
  en: {
    play: 'Play', collection: 'Collection', deckbuilder: 'Deck Builder',
    quests: 'Quests & Achievements', spectate: 'Spectate (CPU vs CPU)', draft: 'Draft Mode',
  },
  // add more languages here
};
function t(key) { const lang = localStorage.getItem('chimera_lang') || 'en'; return (I18N[lang] && I18N[lang][key]) || key; }

const _dust_btn = document.getElementById('dust-btn'); if (_dust_btn) _dust_btn.addEventListener('click', () => {
  const commons = allCards.filter(c => profile.unlocked[c.id] && c.rarity === 'Common');
  const lockedRares = allCards.filter(c => !profile.unlocked[c.id] && (c.rarity === 'Rare' || c.rarity === 'Legendary'));
  if (commons.length < 4 || lockedRares.length === 0) { alert('Need 4+ commons and a locked rare'); return; }
  // lock 4 random commons
  shuffle(commons).slice(0,4).forEach(c => { delete profile.unlocked[c.id]; });
  const pick = lockedRares[Math.floor(Math.random()*lockedRares.length)];
  profile.unlocked[pick.id] = true;
  saveProfile();
  renderCollection();
  alert('Dusted 4 commons for ' + pick.name);
});

// Hot-seat 2P
const _hotseat_btn = document.getElementById('hotseat-btn'); if (_hotseat_btn) _hotseat_btn.addEventListener('click', () => {
  const f1 = factions.filter(f=>f!=='Neutral')[Math.floor(Math.random()*(factions.length-1))];
  const f2 = factions.filter(f=>f!=='Neutral' && f!==f1)[Math.floor(Math.random()*(factions.length-2))];
  const p1 = createPlayer('Player 1', f1, buildDeck(f1));
  const p2 = createPlayer('Player 2', f2, buildDeck(f2));
  G = { turn:'player', turnNumber:1, phase:'main', player:p1, ai:p2, log:[], playerFirstDrawDone:false, pendingRevives:[], reviveQueue:[], destroyedCount:0, hotseat:true };
  for (let i=0;i<5;i++){ draw(G.player); draw(G.ai); }
  G.playerFirstDrawDone = true;
  G.player.maxEssence = 1; G.player.essence = 1; G.ai.maxEssence = 0; G.ai.essence = 0;
  showScreen('game-screen');
  render();
  log('Hot-Seat: ' + f1 + ' (P1) vs ' + f2 + ' (P2). Player 1 starts.');
});

// Modify endTurn for hot-seat: swap players and start new turn
const _origEndTurn = endTurn;
endTurn = function() {
  if (G && G.hotseat) {
    const p = G.player;
    // damage cleanup
    G.player.front.forEach(u=>u.damage=0); G.player.back.forEach(u=>u.damage=0);
    G.ai.front.forEach(u=>u.damage=0); G.ai.back.forEach(u=>u.damage=0);
    G.player.essence = 0;
    while (G.player.hand.length > 7) G.player.discard.push(G.player.hand.pop());
    // swap
    const tmp = G.player; G.player = G.ai; G.ai = tmp;
    log('Pass device. ' + G.player.name + "\'s turn.");
    startTurn('player');
    return;
  }
  _origEndTurn();
};

// Disable AI scheduling in hot-seat: patch startTurn scheduling already checks G.spectator; add hotseat
const _origStartTurn2 = startTurn;


// Dynamic music layers
let combatOsc = null, combatGain = null;
function startCombatMusic() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (combatOsc) return;
    combatOsc = audioCtx.createOscillator();
    combatGain = audioCtx.createGain();
    combatOsc.type = 'sawtooth';
    combatOsc.frequency.value = 80;
    combatGain.gain.value = 0.02;
    combatOsc.connect(combatGain); combatGain.connect(audioCtx.destination);
    combatOsc.start();
    // rhythmic LFO
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.frequency.value = 4; lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain); lfoGain.connect(combatGain.gain);
    lfo.start();
  } catch(e) {}
}
function stopCombatMusic() {
  try { if (combatOsc) { combatOsc.stop(); combatOsc = null; combatGain = null; } } catch(e) {}
}
function playJingle(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = type === 'win' ? [523,659,784,1046] : [392,330,262,196];
    notes.forEach((f,i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'triangle'; o.frequency.value = f; g.gain.value = 0.08;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i*0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i*0.18 + 0.25);
      o.stop(audioCtx.currentTime + i*0.18 + 0.25);
    });
  } catch(e) {}
}

// Hook combat music
const _origDeclareAttack = declareAttack;
declareAttack = function() {
  startCombatMusic();
  _origDeclareAttack();
  setTimeout(stopCombatMusic, 1500);
};
// Hook jingle on game over
const _origGameOverMusic = gameOver;
gameOver = function(title, msg) {
  _origGameOverMusic(title, msg);
  playJingle(title.toLowerCase().includes('win') ? 'win' : 'lose');
};

// Faction themes


function showTargetFaceButton() {
  let btn = document.getElementById('target-face-btn');
  if (!btn) { btn = document.createElement('button'); btn.id='target-face-btn'; btn.textContent='Target Face'; document.querySelector('.controls').appendChild(btn); }
  btn.style.display = '';
  btn.onclick = () => {
    if (!G.targeting) return;
    const t = G.targeting;
    resolveInvocation(t.inst, t.player, t.opponent, 'face');
    t.player.discard.push(t.inst);
    G.targeting = null;
    hideTargetFaceButton();
    render();
  };
}
function hideTargetFaceButton() {
  const btn = document.getElementById('target-face-btn');
  if (btn) btn.style.display = 'none';
}

document.addEventListener('click', (e) => {
  if (!G || !G.targeting) return;
  const card = e.target.closest('.card');
  if (!card || !card.dataset.uid) return;
  const uid = parseInt(card.dataset.uid);
  const unit = [...G.player.front, ...G.player.back, ...G.ai.front, ...G.ai.back].find(u => u && u.uid === uid);
  if (!unit) return;
  const t = G.targeting;
  resolveInvocation(t.inst, t.player, t.opponent, unit);
  t.player.discard.push(t.inst);
  G.targeting = null;
  hideTargetFaceButton();
  render();
  checkGameOver();
});
