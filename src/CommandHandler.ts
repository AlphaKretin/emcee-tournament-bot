import { Logger } from "winston";
import { prettyPrint } from "./discordDeck";
import { DiscordInterface, DiscordMessageIn } from "./discord/interface";
import { UserError } from "./errors";
import { TournamentInterface } from "./TournamentManager";

export class CommandHandler {
	private discord: DiscordInterface;
	private tournamentManager: TournamentInterface;
	private logger: Logger;
	constructor(discord: DiscordInterface, tournamentManager: TournamentInterface, logger: Logger) {
		this.discord = discord;
		this.tournamentManager = tournamentManager;
		this.logger = logger;

		this.discord.registerCommand("help", this.commandHelp.bind(this));
		this.discord.onPing(this.commandHelp.bind(this));
		this.discord.registerCommand("list", this.commandListTournaments.bind(this));
		this.discord.registerCommand("create", this.commandCreateTournament.bind(this));
		this.discord.registerCommand("update", this.commandUpdateTournament.bind(this));
		this.discord.registerCommand("addchannel", this.commandAddChannel.bind(this));
		this.discord.registerCommand("removechannel", this.commandRemoveChannel.bind(this));
		this.discord.registerCommand("addhost", this.commandAddHost.bind(this));
		this.discord.registerCommand("removehost", this.commandRemoveHost.bind(this));
		this.discord.registerCommand("open", this.commandOpenTournament.bind(this));
		this.discord.registerCommand("start", this.commandStartTournament.bind(this));
		this.discord.registerCommand("cancel", this.commandCancelTournament.bind(this));
		this.discord.registerCommand("score", this.commandSubmitScore.bind(this));
		this.discord.registerCommand("round", this.commandNextRound.bind(this));
		this.discord.registerCommand("players", this.commandListPlayers.bind(this));
		this.discord.registerCommand("deck", this.commandGetDeck.bind(this));
		this.discord.registerCommand("drop", this.commandDropPlayerSelf.bind(this));
		this.discord.registerCommand("forcedrop", this.commandDropPlayerByHost.bind(this));
		this.discord.registerCommand("sync", this.commandSyncTournament.bind(this));
		this.discord.registerCommand("pie", this.commandPieChart.bind(this));
		this.discord.registerCommand("addbye", this.commandRegisterBye.bind(this));
		this.discord.registerCommand("removebye", this.commandRemoveBye.bind(this));

		this.discord.onMessage(this.tournamentManager.confirmPlayer.bind(this.tournamentManager));
		this.discord.onDelete(this.tournamentManager.cleanRegistration.bind(this.tournamentManager));
	}

	private validateArgs(args: string[], count: number): string[] {
		for (let i = 0; i < count; i++) {
			const arg = args[i];
			if (arg === undefined || arg.length < 1) {
				throw new UserError(`Missing parameter number ${i}!`);
				// potential to add more checks here in the future if necessary
			}
		}
		return args;
	}

	private async commandHelp(msg: DiscordMessageIn): Promise<void> {
		await msg.reply(
			"Emcee's documentation can be found at https://github.com/AlphaKretin/emcee-tournament-bot/wiki."
		);
	}

	private async commandListTournaments(msg: DiscordMessageIn): Promise<void> {
		await this.discord.authenticateTO(msg);
		const list = await this.tournamentManager.listTournaments();
		await msg.reply(`\`\`\`\n${list}\`\`\``);
	}

	private async commandCreateTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		await this.discord.authenticateTO(msg);
		const [name, desc] = this.validateArgs(args, 2);
		const [id, url] = await this.tournamentManager.createTournament(msg.author, msg.serverId, name, desc);
		this.logger.verbose(`New tournament created ${id} by ${msg.author}.`);
		await msg.reply(
			`Tournament ${name} created! You can find it at ${url}. For future commands, refer to this tournament by the id \`${id}\`.`
		);
	}

	private async commandUpdateTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id, name, desc] = this.validateArgs(args, 3);
		await this.tournamentManager.authenticateHost(id, msg.author);
		await this.tournamentManager.updateTournament(id, name, desc);
		this.logger.verbose(`Tournament ${id} updated with name ${name} and description ${desc} by ${msg.author}.`);
		await msg.reply(`Tournament \`${id}\` updated! It now has the name ${name} and the given description.`);
	}

	private async commandAddChannel(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id, baseType, channelMention] = this.validateArgs(args, 1); // other 2 are optional
		await this.tournamentManager.authenticateHost(id, msg.author);
		let type = baseType ? baseType.toLowerCase().trim() : "public";
		if (!(type === "private")) {
			type = "public";
		}
		let channelId = this.discord.getChannel(channelMention);
		if (!channelId) {
			channelId = msg.channelId;
		}
		await this.tournamentManager.addAnnouncementChannel(id, channelId, type as "public" | "private");
		this.logger.verbose(`Channel ${channelId} added to tournament ${id} with level ${type} by ${msg.author}.`);
		await this.discord.sendMessage(
			channelId,
			`This channel added as a ${type} announcement channel for Tournament ${id}!`
		);
		await msg.reply(
			`${this.discord.mentionChannel(channelId)} added as a ${type} announcement channel for Tournament ${id}!`
		);
	}

	private async commandRemoveChannel(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id, baseType, channelMention] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		let type = baseType ? baseType.toLowerCase().trim() : "public";
		if (!(type === "private")) {
			type = "public";
		}
		let channelId = this.discord.getChannel(channelMention);
		if (!channelId) {
			channelId = msg.channelId;
		}
		await this.tournamentManager.removeAnnouncementChannel(id, channelId, type as "public" | "private");
		this.logger.verbose(`Channel ${channelId} removed from tournament ${id} with level ${type} by ${msg.author}.`);
		await this.discord.sendMessage(
			channelId,
			`This channel removed as a ${type} announcement channel for Tournament ${id}!`
		);
		await msg.reply(
			`${this.discord.mentionChannel(channelId)} removed as a ${type} announcement channel for Tournament ${id}!`
		);
	}

	private async commandAddHost(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const newHost = this.discord.getMentionedUser(msg);
		await this.tournamentManager.addHost(id, newHost);
		this.logger.verbose(`Tournament ${id} added new host ${newHost} by ${msg.author}.`);
		await msg.reply(`${this.discord.mentionUser(newHost)} added as a host for Tournament ${id}!`);
	}

	private async commandRemoveHost(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const newHost = this.discord.getMentionedUser(msg);
		await this.tournamentManager.removeHost(id, newHost);
		this.logger.verbose(`Tournament ${id} removed host ${newHost} by ${msg.author}.`);
		await msg.reply(`${this.discord.mentionUser(newHost)} removed as a host for Tournament ${id}!`);
	}

	private async commandOpenTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		await this.tournamentManager.openTournament(id);
		this.logger.verbose(`Tournament ${id} opened for registration by ${msg.author}.`);
		await msg.reply(`Tournament ${id} opened for registration!`);
	}

	private async commandStartTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		await this.tournamentManager.startTournament(id);
		this.logger.verbose(`Tournament ${id} commenced by ${msg.author}.`);
		await msg.reply(`Tournament ${id} successfully commenced!`);
	}

	private async commandCancelTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		await this.tournamentManager.cancelTournament(id);
		await msg.reply(`Tournament ${id} successfully canceled.`);
	}

	// TODO infer tournamentId from tournament player is in? gotta make player-facing features as simple as possible
	private async commandSubmitScore(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id, score] = this.validateArgs(args, 2); // improve error message clarity if player-facing?
		await this.tournamentManager.authenticatePlayer(id, msg.author);
		const scores = score.split("-");
		const scoreNums = scores.map(s => parseInt(s, 10));
		if (scoreNums.length < 2) {
			throw new UserError("Must provide score in format `#-#` e.g. `2-1`.");
		}
		const response = await this.tournamentManager.submitScore(id, msg.author, scoreNums[0], scoreNums[1]);
		await msg.reply(response);
	}

	private async commandNextRound(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const round = await this.tournamentManager.nextRound(id);
		if (round === -1) {
			await msg.reply(`Tournament ${id} successfully progressed past final round and completed.`);
			return;
		}
		await msg.reply(`Tournament ${id} successfully progressed to round ${round}.`);
	}

	private async commandListPlayers(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const list = await this.tournamentManager.listPlayers(id);
		await msg.reply(`A list of players for tournament ${id} with the theme of their deck is attached.`, list);
	}

	private async commandGetDeck(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const player = this.discord.getMentionedUser(msg);
		const deck = await this.tournamentManager.getPlayerDeck(id, player);
		const name = this.discord.getUsername(player);
		const [message, attachment] = prettyPrint(deck, `${name}.ydk`);
		await msg.reply(message, attachment);
	}

	private async commandDropPlayerSelf(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticatePlayer(id, msg.author);
		await this.tournamentManager.dropPlayer(id, msg.author);
		const name = this.discord.getUsername(msg.author);
		await msg.reply(`Player ${name}, you have successfully dropped from Tournament ${id}.`);
	}

	private async commandDropPlayerByHost(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const player = this.discord.getMentionedUser(msg);
		await this.tournamentManager.dropPlayer(id, player);
		const name = this.discord.getUsername(player);
		await msg.reply(`Player ${name} successfully dropped from Tournament ${id}.`);
	}

	private async commandSyncTournament(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		await this.tournamentManager.syncTournament(id);
		await msg.reply(`Tournament ${id} database successfully synchronised with remote website.`);
	}

	private async commandPieChart(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const csv = await this.tournamentManager.generatePieChart(id);
		await msg.reply(`Archetype counts for Tournament ${id} are attached.`, csv);
	}

	private async commandRegisterBye(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const player = this.discord.getMentionedUser(msg);
		const byes = await this.tournamentManager.registerBye(id, player);
		const names = byes.map(b => `${this.discord.mentionUser(b)} (${this.discord.getUsername(b)})`);
		await msg.reply(
			`Bye registered for Player ${this.discord.mentionUser(player)} (${this.discord.getUsername(
				player
			)}) in Tournament ${id}!\nAll byes: ${names.join(", ")}`
		);
	}

	private async commandRemoveBye(msg: DiscordMessageIn, args: string[]): Promise<void> {
		const [id] = this.validateArgs(args, 1);
		await this.tournamentManager.authenticateHost(id, msg.author);
		const player = this.discord.getMentionedUser(msg);
		const byes = await this.tournamentManager.removeBye(id, player);
		const names = byes.map(b => `${this.discord.mentionUser(b)} (${this.discord.getUsername(b)})`);
		await msg.reply(
			`Bye registered for Player ${this.discord.mentionUser(player)} (${this.discord.getUsername(
				player
			)}) in Tournament ${id}!\nAll byes: ${names.join(", ")}`
		);
	}
}