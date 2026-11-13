// No Luck Bets — friendly-bet bot, works in every server it is added to.
// Env vars (never put secrets in code):
//   DISCORD_TOKEN — bot token from discord.com/developers
//   CLIENT_ID     — application ID from discord.com/developers
//   BETS_DB_PATH (optional) — JSON data file location, default ./data/bets.json
//
// There is no GUILD_ID: commands are registered globally, so the bot works
// in any server it is invited to. Bets, guesses, and leaderboards are kept
// separate per server (see db.js).
//
// Intents: Guilds only. The bot never reads messages and never needs the
// member list — winners are named by the settling mod, not drawn.
// No privileged intents are needed.

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const { commandData, handleBetCommand } = require('./commands');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Set it and start the bot again (see README.md).`);
    process.exit(1);
  }
  return value;
}

const token = requireEnv('DISCORD_TOKEN');
const clientId = requireEnv('CLIENT_ID');
// GUILD_ID is intentionally not read: it is no longer needed. If it is set
// in the environment (e.g. left over from the single-server setup), it is
// ignored.

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  // Global commands: they appear in every server the bot is added to.
  // Discord can take up to about an hour to show them in a newly added
  // server, so don't re-register guild copies — that would duplicate them.
  await rest.put(Routes.applicationCommands(clientId), { body: [commandData.toJSON()] });
  console.log('Registered /bet commands globally.');
}

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}.`);
    try {
      await registerCommands();
    } catch (err) {
      console.error('Command registration failed:', err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'bet') {
        if (!interaction.guildId) {
          await interaction.reply({ content: 'Bets only work in a server, not in DMs.', ephemeral: true });
          return;
        }
        await handleBetCommand(interaction);
      }
    } catch (err) {
      console.error('Interaction failed:', err);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Something went wrong running that command.', ephemeral: true }).catch(() => null);
      }
    }
  });

  await client.login(token);
}

main().catch((err) => {
  console.error(`Bot failed to start: ${err.message}`);
  process.exit(1);
});
