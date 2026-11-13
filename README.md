# No Luck Bets

A Discord bot for friendly bets — no cash, no virtual currency, no
payouts. Someone posts a bet, members make free-text guesses, and a mod
settles it by naming the winner. Winners get 1 point each, and
`/bet leaderboard` keeps the running score.

It works in **every server it is added to** — bets, guesses, and
leaderboards are kept separate per server, so a bet in one server never
shows up in another.

The first bet it was built for: "How long before Jake buys another game?"
Members guess timeframes ("3 days", "by Friday", "tomorrow"), and when Jake
buys a game a mod settles it — whoever was closest wins the point.

## How it works

- **Anyone can start a bet** — `/bet create` with a question. The bot posts
  an embed in the channel with the bet number and how to guess.
- **Free-text guesses** — `/bet guess <id> <guess>`. One guess per person
  per bet; guessing again updates your guess. The bet post's guess count
  updates as guesses come in.
- **Mods settle** — `/bet settle` names the winner (by @mention) and can add
  a note about what actually happened. The bot edits the bet post to show
  the winner, announces it in the channel, and records 1 point for the
  winner. The mod picks the winner — the bot never tries to work out
  "closest" from free-text guesses.
- **Leaderboard** — `/bet leaderboard` shows all-time wins, ranked, with the
  total number of bets settled.
- **No DMs, ever.** Winners are announced in the channel only.
- **Survives restarts.** Bets, guesses, and scores live in a small JSON
  file on Render's persistent disk.
- **One bot, many servers.** Invite it to any server and it just works
  there — each server gets its own bets and its own leaderboard.

## Commands

All commands are `/bet` subcommands. Settling and cancelling require the
**Manage Messages** permission (mods and admins). Everything else is open
to every member.

| Command | What it does |
|---|---|
| `/bet create question:<question> [channel:<#channel>]` | Starts a friendly bet. Defaults to the channel you ran it in. |
| `/bet guess id:<number> guess:<your guess>` | Make your guess on a bet. Guessing again updates it. |
| `/bet list` | Lists open bets with their numbers, questions, and guess counts. |
| `/bet guesses id:<number>` | Shows all guesses on a bet — who said what. |
| `/bet settle id:<number> winner:<@user> [note:<what happened>]` | Settles a bet (mods only). Winner gets 1 point, bet closes, winner announced in the channel. |
| `/bet leaderboard` | All-time wins, ranked, with total bets settled. |
| `/bet cancel id:<number>` | Cancels an open bet with no winner (mods only). |

## Setup — step by step

You only do this once. Nothing here goes through chat — tokens and IDs go
straight from Discord into Render.

### 1. Create the application

1. Go to **https://discord.com/developers** and sign in.
2. Click **New Application**, name it something like `No Luck Bets`, and
   create it.
3. On the **General Information** page, copy the **Application ID** — that is
   your `CLIENT_ID`. Keep this tab open.

### 2. Get the bot token

1. In the left menu, click **Bot**.
2. Click **Reset Token**, then **Copy**. That is your `DISCORD_TOKEN`. Treat
   it like a password — never post it in Discord or send it to anyone.
3. No privileged intents are needed for this bot. Leave "Server Members
   Intent" and "Message Content Intent" off — the bot never reads messages
   and never needs the member list.

### 3. Invite the bot to a server

1. In the left menu, click **OAuth2**, then **URL Generator**.
2. Under **Scopes**, check **bot** and **applications.commands**.
3. Under **Bot Permissions**, check **Send Messages**, **Embed Links**, and
   **Read Message History**.
4. Copy the generated URL at the bottom, open it in your browser, pick a
   server, and authorize. Use the same link for every server you want the
   bot in — you need Manage Server permission on each one. The commands
   are registered globally, so they can take up to about an hour to show
   up in a newly added server; that's Discord, not the bot.

### 4. Deploy on Render

1. Put these files at the root of a GitHub repo.
2. In Render, go to **New → Blueprint** and pick that repo. The included
   `render.yaml` creates a background worker (it stays awake around the clock
   so the bot is always there to take guesses) with a small persistent disk
   for the database. Workers are not on Render's free tier — the starter plan
   is the one in the file.
3. When Render asks for environment variables, fill in:
   - `DISCORD_TOKEN` — the bot token from step 2.
   - `CLIENT_ID` — the application ID from step 1.

   (`BETS_DB_PATH` and `NODE_VERSION` are already set in `render.yaml`.)
   There is no `GUILD_ID` anymore — the bot works in every server it is
   invited to. If `GUILD_ID` is set in Render from the old single-server
   setup, it is ignored.
4. Deploy. In the logs you should see `Logged in as …` and
   `Registered /bet commands globally.`. If a variable is missing, the
   bot stops with a plain message naming it instead of crashing.

### 5. Test it (takes about a minute)

1. In the server, run `/bet create question:How long before Jake buys another game?`
   (If the command doesn't show up yet, wait — global commands can take up
   to about an hour to appear in a server for the first time.)
2. The bet post appears with the question and instructions.
3. Guess with `/bet guess id:1 guess:3 days`, then guess again with a
   different timeframe to check it updates.
4. Check `/bet guesses id:1` and `/bet list`.
5. Settle it as a mod: `/bet settle id:1 winner:@someone note:Jake bought Cruis'n World`.
   The post edits to show the winner, the win is announced in the channel,
   and `/bet leaderboard` shows 1 win for them.

## Running it yourself (optional)

Requires Node 20 or newer:

```sh
npm install
DISCORD_TOKEN=… CLIENT_ID=… node src/index.js
```

## Notes

- The bot answers in every server it is in. Bets, guesses, and scores are
  per server — a win in one server never shows on another server's
  leaderboard.
- Guesses are free text — the bot stores exactly what each member typed.
  Settling is a mod's judgement call on which guess was closest.
- If a bet post gets deleted before it settles, the bet still exists in the
  database — settle or cancel it by ID and the announcement still posts.
