// Simple JSON file store. Bets, guesses, and scores survive a bot restart.
// On Render, point BETS_DB_PATH at the persistent disk (see render.yaml),
// otherwise restarts on an ephemeral filesystem will lose the data file.
//
// A JSON file is used instead of SQLite because the native SQLite module
// cannot build in this sandbox (its build step is blocked), and the bot's
// data is tiny — a handful of bets for one server — so a file rewritten
// atomically on each change is more than enough. Writes are synchronous and
// atomic (temp file + rename) so a crash mid-write never corrupts the store.
//
// Scores are per server: guild ID -> user ID -> wins. Bets already carry
// guild_id and every lookup filters on it, so a bet, guess, or win in one
// server can never leak into another.

const path = require('node:path');
const fs = require('node:fs');

const dbPath = process.env.BETS_DB_PATH || path.join(__dirname, '..', 'data', 'bets.json');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

function emptyStore() {
  return { nextBetId: 1, bets: [], scores: {} };
}

function load() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const store = JSON.parse(raw);
    if (!store || !Array.isArray(store.bets) || typeof store.scores !== 'object' || store.scores === null) {
      return emptyStore();
    }
    if (typeof store.nextBetId !== 'number') {
      store.nextBetId = store.bets.reduce((max, b) => Math.max(max, b.id), 0) + 1;
    }
    // Migration: scores used to be a flat user ID -> wins map (single
    // server). Rebuild them per server from the settled bets, so wins stay
    // attributed to the server where they were earned. Any win that cannot
    // be tied to a settled bet is dropped rather than guessed at.
    if (isFlatScores(store.scores)) {
      const rebuilt = {};
      for (const b of store.bets) {
        if (b.status === 'settled' && b.winner_id && b.guild_id) {
          rebuilt[b.guild_id] = rebuilt[b.guild_id] || {};
          rebuilt[b.guild_id][b.winner_id] = (rebuilt[b.guild_id][b.winner_id] || 0) + 1;
        }
      }
      store.scores = rebuilt;
      store._scoresMigrated = true;
    }
    return store;
  } catch {
    return emptyStore();
  }
}

// Flat (old) shape: { userId: wins }. Per-server shape: { guildId: { userId: wins } }.
function isFlatScores(scores) {
  return Object.values(scores).some((v) => typeof v === 'number');
}

let store = load();

// Persist the migrated scores shape on startup so the file matches the
// in-memory store even if nothing changes afterwards.
if (store._scoresMigrated) {
  delete store._scoresMigrated;
  save();
}

function save() {
  const tmpPath = `${dbPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  fs.renameSync(tmpPath, dbPath);
}

function copyBet(bet) {
  return { ...bet, guesses: bet.guesses.map((g) => ({ ...g })) };
}

function createBet({ guildId, channelId, question, createdBy }) {
  const bet = {
    id: store.nextBetId++,
    guild_id: guildId,
    channel_id: channelId,
    message_id: null,
    question,
    status: 'open',
    guesses: [],
    created_by: createdBy,
    created_at: Date.now(),
    winner_id: null,
    settle_note: null,
    settled_by: null,
    settled_at: null,
  };
  store.bets.push(bet);
  save();
  return copyBet(bet);
}

function setMessageId(betId, guildId, messageId) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  if (b) {
    b.message_id = messageId;
    save();
  }
}

function getBetById(betId, guildId) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  return b ? copyBet(b) : undefined;
}

function listOpenBets(guildId) {
  return store.bets
    .filter((b) => b.guild_id === guildId && b.status === 'open')
    .sort((a, b) => a.created_at - b.created_at)
    .map(copyBet);
}

// One guess per person per bet; guessing again updates your guess.
// Returns the updated bet, or null if the bet isn't open.
function addOrUpdateGuess(betId, guildId, userId, guessText) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  if (!b || b.status !== 'open') return null;
  const existing = b.guesses.find((g) => g.user_id === userId);
  if (existing) {
    existing.guess = guessText;
    existing.updated_at = Date.now();
  } else {
    b.guesses.push({ user_id: userId, guess: guessText, updated_at: Date.now() });
  }
  save();
  return copyBet(b);
}

function listGuesses(betId, guildId) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  return b ? b.guesses.map((g) => ({ ...g })) : null;
}

// Closes the bet and gives the winner 1 point. The mod picks the winner —
// the bot never tries to work out "closest" from free-text guesses.
// Returns the settled bet, or null if the bet isn't open.
function settleBet(betId, guildId, winnerId, note, settledBy) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  if (!b || b.status !== 'open') return null;
  b.status = 'settled';
  b.winner_id = winnerId;
  b.settle_note = note ?? null;
  b.settled_by = settledBy;
  b.settled_at = Date.now();
  const guildScores = (store.scores[guildId] = store.scores[guildId] || {});
  guildScores[winnerId] = (guildScores[winnerId] || 0) + 1;
  save();
  return copyBet(b);
}

function cancelBet(betId, guildId) {
  const b = store.bets.find((row) => row.id === betId && row.guild_id === guildId);
  if (!b || b.status !== 'open') return null;
  b.status = 'cancelled';
  save();
  return copyBet(b);
}

function getLeaderboard(guildId) {
  const guildScores = store.scores[guildId] || {};
  const entries = Object.entries(guildScores)
    .map(([user_id, wins]) => ({ user_id, wins }))
    .sort((a, b) => b.wins - a.wins || a.user_id.localeCompare(b.user_id));
  const settledCount = store.bets.filter((b) => b.guild_id === guildId && b.status === 'settled').length;
  return { entries, settledCount };
}

module.exports = {
  createBet,
  setMessageId,
  getBetById,
  listOpenBets,
  addOrUpdateGuess,
  listGuesses,
  settleBet,
  cancelBet,
  getLeaderboard,
};
