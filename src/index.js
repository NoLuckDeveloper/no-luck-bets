// Mythic's Gathering friendly-bet bot.
// Env vars (never put secrets in code):
//   DISCORD_TOKEN — bot token from discord.com/developers
//   CLIENT_ID     — application ID from discord.com/developers
//   GUILD_ID      — the Mythic's Gathering server ID (guild commands, fast updates)
//   BETS_DB_PATH (optional) — JSON data file location, default ./data/bets.json
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
const guildId = requireEnv('GUILD_ID');

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [commandData.toJSON()] });
  console.log(`Registered /bet commands for guild ${guildId}.`);
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
        if (interaction.guildId !== guildId) {
          await interaction.reply({ content: 'This bot only runs in its home server.', ephemeral: true });
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
