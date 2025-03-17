import {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
  User,
  PermissionFlagsBits,
  Partials,
} from "discord.js";
import { Rcon } from "rcon-client";
import fs from "fs";
import path from "path";

interface Whitelist {
  linkedUsers: Record<string, string>;
}

const WHITELIST_FILE = path.join(__dirname, "whitelist.json");

const defaultConfig: Whitelist = {
  linkedUsers: {},
};

function loadWhitelist(): Whitelist {
  try {
    if (fs.existsSync(WHITELIST_FILE)) {
      const data = fs.readFileSync(WHITELIST_FILE, "utf8");
      return JSON.parse(data);
    } else {
      saveWhitelist(defaultConfig);
      return defaultConfig;
    }
  } catch (error) {
    console.error("Erro ao carregar configuração:", error);
    return defaultConfig;
  }
}

function saveWhitelist(whitelist: Whitelist): void {
  try {
    fs.writeFileSync(
      WHITELIST_FILE,
      JSON.stringify(whitelist, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("Erro ao salvar configuração:", error);
  }
}

async function runMinecraftCommand(command: string): Promise<string> {
  try {
    const rcon = await Rcon.connect({
      host: process.env.RCON_HOST || "localhost",
      port: process.env.RCON_PORT ? parseInt(process.env.RCON_PORT) : 25575,
      password: process.env.RCON_PASSWORD || "",
    });

    const response = await rcon.send(command);
    await rcon.end();

    return response;
  } catch (error) {
    console.error("Error executing Minecraft command:", error);
    return "";
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

const commands = [
  new SlashCommandBuilder()
    .setName("linkmc")
    .setDescription("Link your Minecraft account to Discord")
    .addStringOption((option) =>
      option
        .setName("username")
        .setDescription("Your Minecraft IGN")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("unlinkmc")
    .setDescription("Unlink your Minecraft account from Discord"),

  new SlashCommandBuilder()
    .setName("checkmc")
    .setDescription("Verify the Minecraft account linked to a user")
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to check the linked account")
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

(async () => {
  try {
    console.log("Registering slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID!,
        process.env.GUILD_ID!
      ),
      { body: commands.map((command) => command.toJSON()) }
    );

    console.log("Commands registered!");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

client.once(Events.ClientReady, () => {
  console.log(`Ready as ${client.user?.tag}!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName } = interaction;

  if (commandName === "linkmc") {
    const whitelist = loadWhitelist();
    const userId = interaction.user.id;
    const minecraftUsername = interaction.options.get("username")
      ?.value as string;

    if (!/^[a-zA-Z0-9_]{3,16}$/.test(minecraftUsername)) {
      await interaction.reply({
        content:
          "The ign inputed is invalid. It should only contain letters, numbers and underscores, with 3-16 chars.",
        ephemeral: true,
      });
      return;
    }

    if (whitelist.linkedUsers[userId]) {
      const oldUsername = whitelist.linkedUsers[userId];
      await interaction.reply({
        content: `Your account is already linked to \`${oldUsername}\`. Updating it to \`${minecraftUsername}\`...`,
        ephemeral: true,
      });
      await runMinecraftCommand(`whitelist remove ${oldUsername}`);
    } else {
      await interaction.reply({
        content: `Linking your account to \`${minecraftUsername}\`...`,
        ephemeral: true,
      });
    }

    const result = await runMinecraftCommand(
      `whitelist add ${minecraftUsername}`
    );

    if (result && result.includes("Added")) {
      whitelist.linkedUsers[userId] = minecraftUsername;
      saveWhitelist(whitelist);

      if (process.env.WHIETLISTED_ROLE_ID) {
        const guild = interaction.guild;
        const member = guild?.members.cache.get(userId);
        const role = guild?.roles.cache.get(process.env.WHIETLISTED_ROLE_ID);

        if (member && role) {
          await member.roles.add(role);
        }
      }

      await interaction.followUp({
        content: `You've linked your account to \`${minecraftUsername}\` successfully!`,
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: `Error adding \`${minecraftUsername}\` to the whitelist. Verify if you typed the username correctly.`,
        ephemeral: true,
      });
    }
  } else if (commandName === "unlinkmc") {
    const whitelist = loadWhitelist();
    const userId = interaction.user.id;

    if (whitelist.linkedUsers[userId]) {
      const minecraftUsername = whitelist.linkedUsers[userId];

      await runMinecraftCommand(`whitelist remove ${minecraftUsername}`);

      delete whitelist.linkedUsers[userId];
      saveWhitelist(whitelist);

      if (process.env.WHIETLISTED_ROLE_ID) {
        const guild = interaction.guild;
        const member = guild?.members.cache.get(userId);
        const role = guild?.roles.cache.get(process.env.WHIETLISTED_ROLE_ID);

        if (member && role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role);
        }
      }

      await interaction.reply({
        content: `Your account has been unlinked from \`${minecraftUsername}\`!`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "You don't have a Minecraft account linked.",
        ephemeral: true,
      });
    }
  } else if (commandName === "checkmc") {
    const config = loadWhitelist();
    const user = interaction.options.get("user")?.user as User;
    const userId = user.id;

    if (config.linkedUsers[userId]) {
      const minecraftUsername = config.linkedUsers[userId];
      await interaction.reply({
        content: `${user} is linked to the IGN \`${minecraftUsername}\`.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `${user} doesn't have a Minecraft account linked.`,
        ephemeral: true,
      });
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const whitelist = loadWhitelist();
  const userId = member.id;

  if (whitelist.linkedUsers[userId]) {
    const minecraftUsername = whitelist.linkedUsers[userId];

    await runMinecraftCommand(`whitelist remove ${minecraftUsername}`);

    delete whitelist.linkedUsers[userId];
    saveWhitelist(whitelist);
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const whitelist = loadWhitelist();
  const linkedRoleId = process.env.WHIETLISTED_ROLE_ID;

  if (!linkedRoleId) return;

  const hadRole = oldMember.roles.cache.has(linkedRoleId);
  const hasRole = newMember.roles.cache.has(linkedRoleId);

  if (hadRole && !hasRole) {
    const userId = newMember.id;

    if (whitelist.linkedUsers[userId]) {
      const minecraftUsername = whitelist.linkedUsers[userId];
      await runMinecraftCommand(`whitelist remove ${minecraftUsername}`);

      delete whitelist.linkedUsers[userId];
      saveWhitelist(whitelist);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
