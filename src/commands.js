// Slash command definitions and handlers for /bet.
// Subcommands: create, guess, list, guesses, settle, leaderboard, cancel.
// settle and cancel require Manage Messages (mods and admins).
// create, guess, list, guesses, and leaderboard are open to every member.
// No money, no virtual currency, no payouts — points only. No DMs anywhere.

const {
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('./db');
const { buildBetEmbed, fetchBetMessage } = require('./bet');

const MAX_GUESS_LENGTH = 200;
const MAX_QUESTION_LENGTH = 300;
const MAX_NOTE_LENGTH = 300;

const commandData = new SlashCommandBuilder()
  .setName('bet')
  .setDescription('Friendly bets — free-text guesses, mod-settled, points only')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Start a new friendly bet')
      .addStringOption((opt) =>
        opt.setName('question').setDescription('The bet, e.g. "How long before Jake buys another game?"').setRequired(true).setMaxLength(MAX_QUESTION_LENGTH),
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post in (defaults to this channel)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('guess')
      .setDescription('Make your guess on a bet (guessing again updates it)')
      .addIntegerOption((opt) => opt.setName('id').setDescription('Bet number, shown in the bet post').setRequired(true).setMinValue(1))
      .addStringOption((opt) =>
        opt.setName('guess').setDescription('Your free-text guess, e.g. "3 days" or "by Friday"').setRequired(true).setMaxLength(MAX_GUESS_LENGTH),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List open bets in this server'))
  .addSubcommand((sub) =>
    sub
      .setName('guesses')
      .setDescription('Show all guesses on a bet')
      .addIntegerOption((opt) => opt.setName('id').setDescription('Bet number, shown in the bet post').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('settle')
      .setDescription('Settle a bet and give the winner a point (mods only)')
      .addIntegerOption((opt) => opt.setName('id').setDescription('Bet number, shown in the bet post').setRequired(true).setMinValue(1))
      .addUserOption((opt) => opt.setName('winner').setDescription('Who had the closest guess').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('note').setDescription('What actually happened, e.g. "Jake bought Cruis\'n World on Nov 12"').setMaxLength(MAX_NOTE_LENGTH),
      ),
  )
  .addSubcommand((sub) => sub.setName('leaderboard').setDescription('All-time bet wins, ranked'))
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Cancel an open bet with no winner (mods only)')
      .addIntegerOption((opt) => opt.setName('id').setDescription('Bet number, shown in the bet post').setRequired(true).setMinValue(1)),
  );

function needsManageMessages(interaction) {
  const perms = interaction.memberPermissions;
  return perms && perms.has(PermissionFlagsBits.ManageMessages);
}

function findOpenBet(interaction, betId) {
  const bet = db.getBetById(betId, interaction.guild.id);
  if (!bet) return { error: `No bet #${betId} in this server.` };
  if (bet.status !== 'open') return { error: `Bet #${betId} is already ${bet.status}.` };
  return { bet };
}

async function refreshBetPost(interaction, bet) {
  const { message } = await fetchBetMessage(interaction.client, bet);
  if (message) {
    await message.edit({ embeds: [buildBetEmbed(bet)] }).catch(() => null);
  }
}

async function handleCreate(interaction) {
  const question = interaction.options.getString('question');
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const guild = interaction.guild;

  const bet = db.createBet({
    guildId: guild.id,
    channelId: channel.id,
    question,
    createdBy: interaction.user.id,
  });

  let message;
  try {
    message = await channel.send({ embeds: [buildBetEmbed(bet)] });
  } catch (err) {
    return interaction.reply({
      content: `I couldn't post in <#${channel.id}>. Check I have Send Messages and Embed Links there. (${err.message})`,
      ephemeral: true,
    });
  }

  db.setMessageId(bet.id, message.id);

  return interaction.reply({
    content: `Bet #${bet.id} is open in <#${channel.id}> — **${question}** Guess with \`/bet guess ${bet.id} <your guess>\`.`,
    ephemeral: true,
  });
}

async function handleGuess(interaction) {
  const betId = interaction.options.getInteger('id');
  const guessText = interaction.options.getString('guess');
  const { bet, error } = findOpenBet(interaction, betId);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const hadGuess = bet.guesses.some((g) => g.user_id === interaction.user.id);
  const updated = db.addOrUpdateGuess(betId, interaction.guild.id, interaction.user.id, guessText);
  if (!updated) return interaction.reply({ content: `Bet #${betId} is no longer open.`, ephemeral: true });

  await refreshBetPost(interaction, updated);

  return interaction.reply({
    content: hadGuess
      ? `Your guess on bet #${betId} is updated to **${guessText}**.`
      : `You're in on bet #${betId} with **${guessText}**.`,
    ephemeral: true,
  });
}

async function handleList(interaction) {
  const open = db.listOpenBets(interaction.guild.id);
  if (open.length === 0) {
    return interaction.reply({ content: 'No open bets right now. Start one with `/bet create`.', ephemeral: true });
  }
  const lines = open.map(
    (b) => `• **Bet #${b.id}** — ${b.question} — ${b.guesses.length} guess${b.guesses.length === 1 ? '' : 'es'} — <#${b.channel_id}>`,
  );
  return interaction.reply({ content: `Open bets:\n${lines.join('\n')}`, ephemeral: true });
}

async function handleGuesses(interaction) {
  const betId = interaction.options.getInteger('id');
  const bet = db.getBetById(betId, interaction.guild.id);
  if (!bet) return interaction.reply({ content: `No bet #${betId} in this server.`, ephemeral: true });
  if (bet.guesses.length === 0) {
    return interaction.reply({ content: `Bet #${betId} — **${bet.question}**\nNo guesses yet.`, ephemeral: true });
  }
  const lines = bet.guesses.map((g) => `• <@${g.user_id}>: ${g.guess}`);
  const status = bet.status === 'open' ? 'open' : `${bet.status}${bet.winner_id ? ` — winner <@${bet.winner_id}>` : ''}`;
  return interaction.reply({
    content: `Bet #${betId} — **${bet.question}** (${status})\n${lines.join('\n')}`,
    ephemeral: true,
  });
}

async function handleSettle(interaction) {
  if (!needsManageMessages(interaction)) {
    return interaction.reply({ content: 'You need the Manage Messages permission to settle a bet.', ephemeral: true });
  }
  const betId = interaction.options.getInteger('id');
  const winner = interaction.options.getUser('winner');
  const note = interaction.options.getString('note');
  const { bet, error } = findOpenBet(interaction, betId);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const winnerGuess = bet.guesses.find((g) => g.user_id === winner.id);
  const settled = db.settleBet(betId, interaction.guild.id, winner.id, note, interaction.user.id);
  if (!settled) return interaction.reply({ content: `Bet #${betId} is no longer open.`, ephemeral: true });

  await refreshBetPost(interaction, settled);

  const announcement = winnerGuess
    ? `🏆 <@${winner.id}> wins **bet #${betId}** — ${bet.question}\nWinning guess: "${winnerGuess.guess}"${note ? `\n${note}` : ''}`
    : `🏆 <@${winner.id}> wins **bet #${betId}** — ${bet.question}${note ? `\n${note}` : ''}\n(They hadn't guessed on this bet — the mod picked them anyway.)`;

  const { channel } = await fetchBetMessage(interaction.client, settled);
  if (channel && channel.isTextBased()) {
    await channel.send(announcement).catch(() => null);
  }

  return interaction.reply({
    content: `Bet #${betId} settled — winner <@${winner.id}>. They now have ${db.getLeaderboard(interaction.guild.id).entries.find((e) => e.user_id === winner.id)?.wins ?? 1} win(s).`,
    ephemeral: true,
  });
}

async function handleLeaderboard(interaction) {
  const { entries, settledCount } = db.getLeaderboard(interaction.guild.id);
  if (entries.length === 0) {
    return interaction.reply({ content: 'No settled bets yet — nobody has any wins.', ephemeral: true });
  }
  const top = entries.slice(0, 10);
  const lines = top.map((e, i) => `${i + 1}. <@${e.user_id}> — ${e.wins} win${e.wins === 1 ? '' : 's'}`);
  const extra = entries.length > 10 ? `\n…and ${entries.length - 10} more.` : '';
  return interaction.reply({
    content: `🏆 Bet leaderboard (${settledCount} bet${settledCount === 1 ? '' : 's'} settled):\n${lines.join('\n')}${extra}`,
    ephemeral: true,
  });
}

async function handleCancel(interaction) {
  if (!needsManageMessages(interaction)) {
    return interaction.reply({ content: 'You need the Manage Messages permission to cancel a bet.', ephemeral: true });
  }
  const betId = interaction.options.getInteger('id');
  const { bet, error } = findOpenBet(interaction, betId);
  if (error) return interaction.reply({ content: error, ephemeral: true });

  const cancelled = db.cancelBet(betId, interaction.guild.id);
  if (!cancelled) return interaction.reply({ content: `Bet #${betId} is no longer open.`, ephemeral: true });

  await refreshBetPost(interaction, cancelled);

  const { channel } = await fetchBetMessage(interaction.client, cancelled);
  if (channel && channel.isTextBased()) {
    await channel.send(`🚫 Bet #${betId} was cancelled by a mod — no winner.`).catch(() => null);
  }

  return interaction.reply({ content: `Bet #${betId} cancelled.`, ephemeral: true });
}

async function handleBetCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return handleCreate(interaction);
  if (sub === 'guess') return handleGuess(interaction);
  if (sub === 'list') return handleList(interaction);
  if (sub === 'guesses') return handleGuesses(interaction);
  if (sub === 'settle') return handleSettle(interaction);
  if (sub === 'leaderboard') return handleLeaderboard(interaction);
  if (sub === 'cancel') return handleCancel(interaction);
  return interaction.reply({ content: 'Unknown bet command.', ephemeral: true });
}

module.exports = { commandData, handleBetCommand };
