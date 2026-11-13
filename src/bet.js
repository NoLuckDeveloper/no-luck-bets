// Bet embeds and the settle announcement.
// No money anywhere in this bot — points and bragging rights only.
// Winners are announced by tag in the channel. This bot NEVER sends DMs.

const { EmbedBuilder } = require('discord.js');

const GOLD = 0xFFD700;
const GREEN = 0x00c853;
const GREY = 0x808080;

function buildBetEmbed(bet) {
  const open = bet.status === 'open';
  const color = open ? GOLD : bet.status === 'settled' ? GREEN : GREY;
  const title =
    open ? `🎲 Bet #${bet.id}` : bet.status === 'settled' ? `🏆 Bet #${bet.id} — Settled` : `🚫 Bet #${bet.id} — Cancelled`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields({ name: 'Question', value: bet.question, inline: false });

  if (open) {
    embed.addFields(
      {
        name: 'Guesses',
        value:
          bet.guesses.length === 0
            ? 'No guesses yet — be the first!'
            : `${bet.guesses.length} guess${bet.guesses.length === 1 ? '' : 'es'} so far`,
        inline: true,
      },
      {
        name: 'How to guess',
        value: `\`/bet guess ${bet.id} <your guess>\` — one guess each, guessing again updates yours.`,
        inline: false,
      },
    );
  } else if (bet.status === 'settled') {
    const winnerGuess = bet.guesses.find((g) => g.user_id === bet.winner_id);
    embed.addFields(
      { name: 'Winner', value: `<@${bet.winner_id}>`, inline: false },
      { name: 'Winning guess', value: winnerGuess ? winnerGuess.guess : 'No guess recorded', inline: false },
    );
    if (bet.settle_note) {
      embed.addFields({ name: 'What happened', value: bet.settle_note, inline: false });
    }
  }

  embed.setFooter({ text: `Bet #${bet.id} · Friendly bets only — no money, just bragging rights` });
  return embed;
}

async function fetchBetMessage(client, bet) {
  try {
    const channel = await client.channels.fetch(bet.channel_id);
    if (!channel || !channel.isTextBased()) return { channel, message: null };
    const message = await channel.messages.fetch(bet.message_id).catch(() => null);
    return { channel, message };
  } catch {
    return { channel: null, message: null };
  }
}

module.exports = { buildBetEmbed, fetchBetMessage };
