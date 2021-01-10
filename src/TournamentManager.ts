import * as csv from "@fast-csv/format";
import { Deck } from "ydeck";
import { DatabaseTournament, TournamentStatus } from "./database/interface";
import { DatabaseWrapperPostgres } from "./database/postgres";
import { getDeck } from "./deck/deck";
import { getDeckFromMessage, prettyPrint } from "./deck/discordDeck";
import { DiscordAttachmentOut, DiscordInterface, DiscordMessageIn, DiscordMessageLimited } from "./discord/interface";
import { Templater } from "./templates";
import { PersistentTimer } from "./timer";
import { BlockedDMsError, ChallongeAPIError, TournamentNotFoundError, UserError } from "./util/errors";
import { getLogger } from "./util/logger";
import { WebsiteInterface, WebsiteTournament } from "./website/interface";

const logger = getLogger("tournament");

interface MatchScore {
	playerId: number;
	playerDiscord: string;
	playerScore: number;
	oppScore: number;
}

export interface TournamentInterface {
	registerPlayer(msg: DiscordMessageIn, playerId: string): Promise<void>;
	confirmPlayer(msg: DiscordMessageIn): Promise<void>;
	cleanRegistration(msg: DiscordMessageLimited): Promise<void>;
	authenticateHost(tournamentId: string, message: DiscordMessageIn): Promise<void>;
	authenticatePlayer(tournamentId: string, message: DiscordMessageIn): Promise<void>;
	listTournaments(server?: string): Promise<string>;
	createTournament(hostId: string, serverId: string, name: string, desc: string): Promise<[string, string, string]>;
	updateTournament(tournamentId: string, name: string, desc: string): Promise<void>;
	addAnnouncementChannel(tournamentId: string, channelId: string, type: "public" | "private"): Promise<void>;
	removeAnnouncementChannel(tournamentId: string, channelId: string, type: "public" | "private"): Promise<void>;
	addHost(tournamentId: string, newHost: string): Promise<void>;
	removeHost(tournamentId: string, newHost: string): Promise<void>;
	openTournament(tournamentId: string): Promise<void>;
	startTournament(tournamentId: string): Promise<void>;
	finishTournament(tournamentId: string, cancel: boolean | undefined): Promise<void>;
	submitScore(
		tournamentId: string,
		playerId: string,
		scorePlayer: number,
		scoreOpp: number,
		host?: boolean
	): Promise<string>;
	nextRound(tournamentId: string, skip?: boolean): Promise<void>;
	listPlayers(tournamentId: string): Promise<DiscordAttachmentOut>;
	getPlayerDeck(tournamentId: string, playerId: string): Promise<Deck>;
	dropPlayer(tournamentId: string, playerId: string, force?: boolean): Promise<void>;
	syncTournament(tournamentId: string): Promise<void>;
	generatePieChart(tournamentId: string): Promise<DiscordAttachmentOut>;
	generateDeckDump(tournamentId: string): Promise<DiscordAttachmentOut>;
	registerBye(tournamentId: string, playerId: string): Promise<string[]>;
	removeBye(tournamentId: string, playerId: string): Promise<string[]>;
}

type Public<T> = Pick<T, keyof T>;
type Tail<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never;

export class TournamentManager implements TournamentInterface {
	private matchScores: Record<number, MatchScore> = {};
	private timers: Record<string, PersistentTimer[]> = {}; // index: tournament id
	constructor(
		private discord: DiscordInterface,
		private database: Public<DatabaseWrapperPostgres>,
		private website: WebsiteInterface,
		private templater: Templater
	) {}

	/// Link seam to override for testing
	protected async createPersistentTimer(
		...args: Tail<Parameters<typeof PersistentTimer.create>>
	): ReturnType<typeof PersistentTimer.create> {
		return await PersistentTimer.create(this.discord, ...args);
	}

	/// Link seam to override for testing
	protected async loadPersistentTimers(): ReturnType<typeof PersistentTimer.loadAll> {
		return await PersistentTimer.loadAll(this.discord);
	}

	public async loadTimers(): Promise<void> {
		if (Object.keys(this.timers).length) {
			logger.warn(new Error("loadTimers called multiple times"));
		} else {
			const timers = await this.loadPersistentTimers();
			let count = 0;
			for (const timer of timers) {
				if (timer.tournament) {
					this.timers[timer.tournament] = (this.timers[timer.tournament] || []).concat(timer);
					count++;
				} else {
					logger.warn(new Error("Aborting orphaned timer"));
					await timer.abort();
				}
			}
			const tournaments = Object.keys(this.timers).length;
			logger.info(`Loaded ${count} of ${timers.length} PersistentTimers for ${tournaments} tournaments.`);
		}
	}

	public async loadButtons(): Promise<void> {
		// TODO: check for repeated calls.
		const messages = await this.database.getRegisterMessages();
		let count = 0;
		for (const message of messages) {
			const discordMessage = await this.discord.getMessage(message.channelId, message.messageId);
			if (discordMessage) {
				this.discord.restoreReactionButton(
					discordMessage,
					this.CHECK_EMOJI,
					this.registerPlayer.bind(this),
					this.dropPlayerReaction.bind(this)
				);
				count++;
			} else {
				logger.warn(`On loading reaction buttons: ${message.channelId} ${message.messageId} was removed`);
			}
		}
		logger.info(`Loaded ${count} of ${messages.length} reaction buttons.`);
	}

	public async authenticateHost(tournamentId: string, message: DiscordMessageIn): Promise<void> {
		await this.database.authenticateHost(tournamentId, message.author);
		logger.verbose(
			JSON.stringify({
				channel: message.channelId,
				message: message.id,
				user: message.author,
				tournament: tournamentId,
				event: "host authorized"
			})
		);
	}

	public async authenticatePlayer(tournamentId: string, message: DiscordMessageIn): Promise<void> {
		await this.database.authenticatePlayer(tournamentId, message.author);
		logger.verbose(
			JSON.stringify({
				channel: message.channelId,
				message: message.id,
				user: message.author,
				tournament: tournamentId,
				event: "player authorized"
			})
		);
	}

	public async listTournaments(server?: string): Promise<string> {
		const list = await this.database.getActiveTournaments(server);
		const text = list.map(t => `ID: ${t.id}|Name: ${t.name}|Status: ${t.status}|Players: ${t.players.length}`);
		return text.join("\n");
	}

	private async checkUrlTaken(url: string): Promise<boolean> {
		try {
			await this.website.getTournament(url);
			return true;
		} catch (e) {
			// This is an error which means the name is taken,
			// just not by Emcee.
			if (e.message === "You only have read access to this tournament") {
				return true;
			}
			// If the error is it not being found on website,
			// we should continue to the database check
			if (!(e instanceof ChallongeAPIError)) {
				throw e;
			}
		}
		try {
			await this.database.getTournament(url);
			return true;
		} catch (e) {
			if (e instanceof TournamentNotFoundError) {
				return false;
			}
			throw e;
		}
	}

	public async createTournament(
		hostId: string,
		serverId: string,
		name: string,
		desc: string,
		topCut = false
	): Promise<[string, string, string]> {
		// generate a URL based on the name, with added numbers to prevent conflicts
		const baseUrl = name.toLowerCase().replace(/[^a-zA-Z0-9_]/g, "");
		let candidateUrl = `${baseUrl}`;
		let i = 0;
		// while a tournament with that ID exists, the URL is taken
		while (await this.checkUrlTaken(candidateUrl)) {
			candidateUrl = `${baseUrl}${i}`;
			i++;
		}

		const web = await this.website.createTournament(name, desc, candidateUrl, topCut);
		await this.database.createTournament(hostId, serverId, web.id, name, desc);
		return [web.id, web.url, this.templater.format("create", web.id)];
	}

	public async updateTournament(tournamentId: string, name: string, desc: string): Promise<void> {
		// Update DB first because it performs an important check that might throw
		await this.database.updateTournament(tournamentId, name, desc);
		await this.website.updateTournament(tournamentId, name, desc);
	}

	public async addAnnouncementChannel(
		tournamentId: string,
		channelId: string,
		type: "public" | "private"
	): Promise<void> {
		await this.database.addAnnouncementChannel(tournamentId, channelId, type);
	}

	public async removeAnnouncementChannel(
		tournamentId: string,
		channelId: string,
		type: "public" | "private"
	): Promise<void> {
		await this.database.removeAnnouncementChannel(tournamentId, channelId, type);
	}

	public async addHost(tournamentId: string, newHost: string): Promise<void> {
		await this.database.addHost(tournamentId, newHost);
	}

	public async removeHost(tournamentId: string, newHost: string): Promise<void> {
		await this.database.removeHost(tournamentId, newHost);
	}

	private async handleDmFailure(playerId: string, tournament: DatabaseTournament): Promise<void> {
		const channels = tournament.privateChannels;
		await Promise.all(
			channels.map(async c => {
				await this.discord.sendMessage(
					c,
					`Player ${this.discord.mentionUser(playerId)} (${this.discord.getUsername(
						playerId
					)}) is trying to sign up for Tournament ${tournament.name} (${
						tournament.id
					}), but I cannot send them DMs. Please ask them to allow DMs from this server.`
				);
			})
		);
	}

	public async registerPlayer(msg: DiscordMessageIn, playerId: string): Promise<void> {
		const tournaments = await this.database.getPendingTournaments(playerId);
		if (tournaments.length > 0) {
			await this.discord.removeUserReaction(msg.channelId, msg.id, this.CHECK_EMOJI, playerId);
			throw new UserError(
				`You can only sign up for 1 Tournament at a time! Please either drop from or complete your registration for ${tournaments[0].name}!`
			);
		}
		// addPendingPlayer needs to status-guard for preparing tournament
		const tournament = await this.database.addPendingPlayer(msg.channelId, msg.id, playerId);
		if (tournament) {
			try {
				await this.discord.sendDirectMessage(
					playerId,
					`You are registering for ${tournament.name}. ` +
						"Please submit a deck to complete your registration, by uploading a YDK file or sending a message with a YDKE URL."
				);
				logger.verbose(`User ${playerId} registered for tournament ${tournament.id}.`);
			} catch (e) {
				if (e instanceof BlockedDMsError) {
					await this.handleDmFailure(playerId, tournament);
				} else {
					throw e;
				}
			}
		}
	}

	public async confirmPlayer(msg: DiscordMessageIn): Promise<void> {
		// only check decklists in DMs
		if (msg.serverId !== "private") {
			return;
		}
		const tournaments = await this.database.getPendingTournaments(msg.author);
		if (tournaments.length > 1) {
			const out = tournaments.map(t => t.name).join(", ");
			await msg.reply(
				`You are registering in multiple tournaments. Please register in one at a time by unchecking the reaction on all others.\n${out}`
			);
			return;
		}
		if (tournaments.length === 1) {
			const tournament = tournaments[0];
			const deck = await getDeckFromMessage(msg);
			if (!deck) {
				await msg.reply("Must provide either attached `.ydk` file or valid `ydke://` URL!");
				return;
			}
			const [content, file] = prettyPrint(deck, `${this.discord.getUsername(msg.author)}.ydk`);
			if (deck.validationErrors.length > 0) {
				await msg.reply(
					`Your deck is not legal for Tournament ${tournament.name}. Please see the print out below for all the errors. You have NOT been registered yet, please submit again with a legal deck.`
				);
				await msg.reply(content, file);
				return;
			}
			const challongeId = await this.website.registerPlayer(
				tournament.id,
				this.discord.getUsername(msg.author),
				msg.author
			);
			await this.database.confirmPlayer(tournament.id, msg.author, challongeId, deck.url);
			await this.discord.grantPlayerRole(msg.author, await this.discord.getPlayerRole(tournament));
			const channels = tournament.privateChannels;
			await Promise.all(
				channels.map(async c => {
					await this.discord.sendMessage(
						c,
						`Player ${this.discord.mentionUser(msg.author)} (${this.discord.getUsername(
							msg.author
						)}) has signed up for Tournament ${tournament.name} (${tournament.id}) with the following deck!`
					);
					await this.discord.sendMessage(c, content, file);
				})
			);
			logger.verbose(`User ${msg.author} confirmed for tournament ${tournament.id}.`);
			await msg.reply(
				`You have successfully signed up for Tournament ${tournament.name}! Your deck is below to double-check.`
			);
			await msg.reply(content, file);
			return;
		}
		// allow confirmed user to resubmit
		const confirmedTourns = await this.database.getConfirmedTournaments(msg.author);
		if (confirmedTourns.length > 1) {
			const out = confirmedTourns.map(t => t.name).join(", ");
			await msg.reply(
				`You're trying to update your deck for a tournament, but you're in multiple! Please choose one by dropping and registering again.\n${out}`
			);
			return;
		}
		if (confirmedTourns.length === 1) {
			const tournament = confirmedTourns[0];
			// tournament already confirmed preparing by filter
			const deck = await getDeckFromMessage(msg);
			if (!deck) {
				await msg.reply("Must provide either attached `.ydk` file or valid `ydke://` URL!");
				return;
			}
			const [content, file] = prettyPrint(deck, `${this.discord.getUsername(msg.author)}.ydk`);
			if (deck.validationErrors.length > 0) {
				await msg.reply(
					`Your new deck is not legal for Tournament ${tournament.name}. Please see the print out below for all the errors. Your deck has not been changed.`
				);
				await msg.reply(content, file);
				return;
			}
			// already registered on website
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const player = tournament.findPlayer(msg.author)!;
			// running for a confirmed player updates the deck
			await this.database.confirmPlayer(tournament.id, msg.author, player.challongeId, deck.url);
			const channels = tournament.privateChannels;
			await Promise.all(
				channels.map(async c => {
					await this.discord.sendMessage(
						c,
						`Player ${this.discord.mentionUser(msg.author)} (${this.discord.getUsername(
							msg.author
						)}) has updated their deck for Tournament ${tournament.name} (${
							tournament.id
						}) to the following!`
					);
					await this.discord.sendMessage(c, content, file);
				})
			);
			logger.verbose(`User ${msg.author} updated deck for tournament ${tournament.id}.`);
			await msg.reply(
				`You have successfully changed your deck for Tournament ${tournament.name}! Your deck is below to double-check.`
			);
			await msg.reply(content, file);
		}
	}

	public async cleanRegistration(msg: DiscordMessageLimited): Promise<void> {
		await this.database.cleanRegistration(msg.channelId, msg.id);
	}

	private CHECK_EMOJI = "✅";
	public async openTournament(tournamentId: string): Promise<void> {
		const tournament = await this.database.getTournament(tournamentId, TournamentStatus.PREPARING);
		const channels = tournament.publicChannels;
		if (channels.length < 1) {
			throw new UserError(
				"You must register at least one public announcement channel before opening a tournament for registration!"
			);
		}
		await Promise.all(
			channels.map(async c => {
				const content = `__Registration now open for **${tournament.name}**!__\n${tournament.description}\n__Click the ${this.CHECK_EMOJI} below to sign up!__`;
				const msg = await this.discord.awaitReaction(
					content,
					c,
					this.CHECK_EMOJI,
					this.registerPlayer.bind(this),
					this.dropPlayerReaction.bind(this)
				);
				await this.database.openRegistration(tournamentId, msg.channelId, msg.id);
			})
		);
		await Promise.all(
			tournament.privateChannels.map(
				async c => await this.discord.sendMessage(c, this.templater.format("open", tournamentId))
			)
		);
	}

	// we could have logic for sending matchups in DMs in this function,
	// but we want this to send first and leave it largely self-contained
	private async sendNewRoundMessage(channelId: string, tournament: DatabaseTournament, url: string): Promise<void> {
		const role = await this.discord.getPlayerRole(tournament);
		const message = `A new round of ${tournament.name} has begun! ${this.discord.mentionRole(
			role
		)}\nPairings will be sent out by Direct Message shortly, or can be found here: ${url}`;
		await this.discord.sendMessage(channelId, message);
	}

	private async cancelTimers(tournament: DatabaseTournament): Promise<void> {
		for (const timer of this.timers[tournament.id] || []) {
			await timer.abort();
		}
		this.timers[tournament.id] = [];
	}

	private async sendMatchupDM(
		tournament: DatabaseTournament,
		receiverId: string,
		opponentId: string,
		opponentName: string | null
	): Promise<void> {
		let message = `A new round of ${tournament.name} has begun! `;
		message += opponentName
			? `Your opponent is ${this.discord.mentionUser(opponentId)} (${opponentName}).`
			: "I couldn't find your opponent. If you don't think you should have a bye for this round, please check the pairings.";
		try {
			await this.discord.sendDirectMessage(receiverId, message);
		} catch (e) {
			await this.reportMatchDMFailure(tournament, receiverId, opponentId);
		}
	}

	private async reportMatchDMFailure(
		tournament: DatabaseTournament,
		userId: string,
		opponent: string
	): Promise<void> {
		for (const channel of tournament.privateChannels) {
			await this.discord.sendMessage(
				channel,
				`I couldn't send a DM to ${this.discord.mentionUser(userId)} (${userId}) about their matchup for ${
					tournament.name
				}. If they're not a human player, this is normal, but otherwise please tell them their opponent is ${this.discord.mentionUser(
					opponent
				)} (${this.discord.getUsername(opponent)}), and vice versa.`
			);
		}
	}

	private async getRealUsername(userId: string): Promise<string | null> {
		// Naive check for an obviously invalid snowflake, such as the BYE# or DUMMY# we insert
		// This saves the overhead of an HTTP request
		if (!userId.length || userId[0] <= "0" || userId[0] >= "9") {
			return null;
		}
		return await this.discord.getRESTUsername(userId);
	}

	private async startNewRound(tournament: DatabaseTournament, url: string, skip = false): Promise<void> {
		const participantRole = this.discord.mentionRole(await this.discord.getPlayerRole(tournament));
		await this.cancelTimers(tournament);
		this.timers[tournament.id] = await Promise.all(
			tournament.publicChannels.map(async channelId => {
				await this.sendNewRoundMessage(channelId, tournament, url);
				return await this.createPersistentTimer(
					new Date(Date.now() + 50 * 60 * 1000), // 50 minutes
					channelId,
					`That's time in the round, ${participantRole}! Please end the current phase, then the player with the lower LP must forfeit!`,
					5, // update every 5 seconds
					tournament.id
				);
			})
		);
		// can skip sending DMs
		if (skip) {
			return;
		}
		// direct message matchups to players
		const matches = await this.website.getMatches(tournament.id);
		const players = await this.website.getPlayers(tournament.id);
		await Promise.all(
			matches.map(async match => {
				const player1 = players.find(p => p.challongeId === match.player1)?.discordId;
				const player2 = players.find(p => p.challongeId === match.player2)?.discordId;
				if (player1 && player2) {
					const name1 = await this.getRealUsername(player1);
					const name2 = await this.getRealUsername(player2);
					if (name1) {
						await this.sendMatchupDM(tournament, player1, player2, name2);
					} else {
						await this.reportMatchDMFailure(tournament, player1, player2);
					}
					if (name2) {
						await this.sendMatchupDM(tournament, player2, player1, name1);
					} else {
						await this.reportMatchDMFailure(tournament, player2, player1);
					}
				} else {
					// This error occuring is an issue on Challonge's end
					logger.warn(
						new Error(
							`Challonge IDs ${player1} and/or ${player2} found in match ${match.matchId} but not the player list.`
						)
					);
				}
			})
		);
		const bye = await this.website.getBye(tournament.id);
		if (bye) {
			await this.discord.sendDirectMessage(
				bye,
				`A new round of ${tournament.name} has begun! You have a bye for this round.`
			);
		}
	}

	public async startTournament(tournamentId: string): Promise<void> {
		const tournament = await this.database.getTournament(tournamentId, TournamentStatus.PREPARING);
		if (tournament.players.length < 2) {
			throw new UserError("Cannot start a tournament without at least 2 confirmed participants!");
		}
		// delete register messages
		// TODO: can be a single transaction instead of relying on onDelete->cleanRegistration,
		//       a totally unclear relationship without the comment
		const messages = await this.database.getRegisterMessages(tournamentId);
		await Promise.all(
			messages.map(async m => {
				// onDelete handler will handle database cleanup
				await this.discord.deleteMessage(m.channelId, m.messageId);
			})
		);
		// drop pending participants
		const droppedPlayers = await this.database.startTournament(tournamentId);
		await Promise.all(
			droppedPlayers.map(async p => {
				await this.discord.sendDirectMessage(
					p,
					`Sorry, Tournament ${tournament.name} has started and you didn't submit a deck, so you have been dropped.`
				);
			})
		);
		// send command guide to players
		const channels = tournament.publicChannels;
		await Promise.all(
			channels.map(async c => await this.discord.sendMessage(c, this.templater.format("player", tournamentId)))
		);
		// send command guide to hosts
		await Promise.all(
			tournament.privateChannels.map(
				async c => await this.discord.sendMessage(c, this.templater.format("start", tournamentId))
			)
		);
		// start tournament on challonge
		await this.website.assignByes(tournamentId, tournament.byes);
		await this.website.startTournament(tournamentId);
		const webTourn = await this.website.getTournament(tournamentId);
		await this.startNewRound(tournament, webTourn.url);
		// drop dummy players once the tournament has started to give players with byes the win
		await this.website.dropByes(tournamentId, tournament.byes.length);
	}

	public async finishTournament(tournamentId: string, cancel = false): Promise<void> {
		const tournament = await this.database.getTournament(tournamentId, TournamentStatus.IPR);
		const channels = tournament.publicChannels;
		let webTourn: WebsiteTournament;
		if (!cancel) {
			webTourn = await this.website.finishTournament(tournamentId);
		} else {
			// TODO: edit description to say cancelled?
			webTourn = await this.website.getTournament(tournamentId);
		}
		await this.cancelTimers(tournament);

		await this.database.finishTournament(tournamentId);
		await Promise.all(
			channels.map(async c => {
				const role = await this.discord.getPlayerRole(tournament);
				await this.discord.sendMessage(
					c,
					`${tournament.name} has ${
						cancel ? "been cancelled." : "concluded!"
					} Thank you all for playing! ${this.discord.mentionRole(role)}\nResults: ${webTourn.url}`
				);
			})
		);
		await this.discord.deletePlayerRole(tournament);
		// this condition both prevents errors with small tournaments
		// and ensures top cuts don't get their own top cuts
		if (!cancel && tournament.players.length > 8) {
			const top = await this.website.getTopCut(tournamentId, 8);
			const [newId] = await this.createTournament(
				tournament.hosts[0], // tournament cannot have 0 hosts by addition on creation and guard on removal
				tournament.server,
				`${tournament.name} Top Cut`,
				`Top Cut for ${tournament.name}`,
				true
			);

			if (tournament.hosts.length > 1) {
				for (const host of tournament.hosts.slice(1)) {
					await this.database.addHost(newId, host);
				}
			}

			const newTournament = await this.database.getTournament(newId);
			const newRole = await this.discord.getPlayerRole(newTournament);
			for (const player of top) {
				const challongeId = await this.website.registerPlayer(
					newId,
					this.discord.getUsername(player.discordId),
					player.discordId
				);
				// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
				const deck = tournament.findPlayer(player.discordId)!.deck;
				await this.database.confirmPlayer(newId, player.discordId, challongeId, deck);
				await this.discord.grantPlayerRole(player.discordId, newRole);
			}
			for (const channel of tournament.publicChannels) {
				await this.database.addAnnouncementChannel(newId, channel, "public");
			}
			for (const channel of tournament.privateChannels) {
				await this.database.addAnnouncementChannel(newId, channel, "private");
			}
			await this.startTournament(newId);
		}
	}

	public async submitScore(
		tournamentId: string,
		playerId: string,
		scorePlayer: number,
		scoreOpp: number,
		host = false
	): Promise<string> {
		const tournament = await this.database.getTournament(tournamentId, TournamentStatus.IPR);
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const player = tournament.findPlayer(playerId)!;
		const match = await this.website.findMatch(tournamentId, player.challongeId);
		// if a host is submitting, skip straight to trusting the score
		if (host) {
			await this.website.submitScore(tournamentId, player.challongeId, scorePlayer, scoreOpp);
			return ""; // output in this case is handled by the command
		}
		const mention = this.discord.mentionUser(playerId); // prepare for multiple uses below
		if (!match) {
			return `Could not find an open match in Tournament ${tournament.name} including you, ${mention}`;
		}
		if (match.matchId in this.matchScores) {
			const score = this.matchScores[match.matchId];
			// player double reporting
			if (score.playerId === player.challongeId) {
				return `You have already reported your score for this match, ${mention}. Please have your opponent confirm the score.`;
			}
			// player correctly confirming
			if (scorePlayer === score.oppScore && scoreOpp === score.playerScore) {
				const weWon = scorePlayer > scoreOpp;
				// in the case of a tie, winnerScore and loserScore will turn out the same
				const winner = weWon ? player.challongeId : score.playerId;
				const winnerScore = weWon ? scorePlayer : scoreOpp;
				const loserScore = weWon ? scoreOpp : scorePlayer;
				await this.website.submitScore(tournamentId, winner, winnerScore, loserScore);
				// send DM to opponent
				const opponent = score.playerDiscord;
				await this.discord.sendDirectMessage(
					opponent,
					`Your opponent has successfully confirmed your score of ${scoreOpp}-${scorePlayer} for Tournament ${tournament.name}, so the score has been saved. Thank you.`
				);
				// report confirmation to hosts
				const channels = tournament.privateChannels;
				const username = this.discord.getUsername(playerId);
				const oppMention = this.discord.mentionUser(opponent);
				const oppName = this.discord.getUsername(opponent);
				await Promise.all(
					channels.map(async c => {
						this.discord.sendMessage(
							c,
							`${mention} (${username}) and ${oppMention} (${oppName}) have reported their score of ${scorePlayer}-${scoreOpp} for Tournament ${tournament.name} (${tournamentId}).`
						);
					})
				);

				return `You have successfully reported a score of ${scorePlayer}-${scoreOpp}, and it matches your opponent's report, so the score has been saved. Thank you, ${mention}.`;
			}
			// player mismatched confirming
			delete this.matchScores[match.matchId];
			return `Your score does not match your opponent's reported score of ${score.oppScore}-${score.playerScore}. Both of you will need to report again, ${mention}.`;
		}
		this.matchScores[match.matchId] = {
			playerId: player.challongeId,
			playerDiscord: player.discordId,
			playerScore: scorePlayer,
			oppScore: scoreOpp
		};
		return `You have reported a score of ${scorePlayer}-${scoreOpp}, ${mention}. Your opponent still needs to confirm this score.`;
	}

	// specifically only handles telling participants about a new round
	// hosts should handle outstanding scores individually with forcescore
	public async nextRound(tournamentId: string, skip = false): Promise<void> {
		const tournament = await this.database.getTournament(tournamentId, TournamentStatus.IPR);
		const webTourn = await this.website.getTournament(tournamentId);
		await this.startNewRound(tournament, webTourn.url, skip);
	}

	public async listPlayers(tournamentId: string): Promise<DiscordAttachmentOut> {
		const tournament = await this.database.getTournament(tournamentId);
		const rows = tournament.players.map(player => {
			const name = this.discord.getUsername(player.discordId);
			const deck = getDeck(player.deck);
			const themes = deck.themes.length > 0 ? deck.themes.join("/") : "No themes";
			return [name, themes];
		});
		rows.unshift(["Player", "Theme"]);
		const contents = await csv.writeToString(rows);
		return {
			filename: `${tournament.name}.csv`,
			contents
		};
	}

	public async getPlayerDeck(tournamentId: string, playerId: string): Promise<Deck> {
		const tourn = await this.database.getTournament(tournamentId);
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const player = tourn.findPlayer(playerId)!;
		return getDeck(player.deck);
	}

	private async dropPlayerReaction(msg: DiscordMessageLimited, playerId: string): Promise<void> {
		// try to remove pending
		const droppedTournament = await this.database.removePendingPlayer(msg.channelId, msg.id, playerId);
		// an unconfirmed player dropping isn't worth reporting to the hosts
		if (droppedTournament) {
			return;
		}
		// if wasn't found pending, try to remove confirmed
		const tournament = await this.database.removeConfirmedPlayerReaction(msg.channelId, msg.id, playerId);
		if (tournament) {
			await this.sendDropMessage(tournament, playerId, tournament.id);
		}
	}

	public async dropPlayer(tournamentId: string, playerId: string, force = false): Promise<void> {
		const tournament = await this.database.removeConfirmedPlayerForce(tournamentId, playerId);
		if (tournament) {
			await this.sendDropMessage(tournament, playerId, tournamentId, force);
		}
	}

	private async sendDropMessage(
		tournament: DatabaseTournament,
		playerId: string,
		tournamentId: string,
		force = false
	): Promise<void> {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		const player = tournament.findPlayer(playerId)!;
		await this.website.removePlayer(tournament.id, player.challongeId);
		await this.discord.removePlayerRole(playerId, await this.discord.getPlayerRole(tournament));
		logger.verbose(`User ${playerId} dropped from tournament ${tournament.id}${force ? " by host" : ""}.`);
		await this.discord.sendDirectMessage(
			playerId,
			force
				? `You have been dropped from Tournament ${tournament.name} by the hosts.`
				: `You have successfully dropped from Tournament ${tournament.name}.`
		);
		const channels = tournament.privateChannels;
		await Promise.all(
			channels.map(
				async c =>
					await this.discord.sendMessage(
						c,
						`Player ${this.discord.mentionUser(playerId)} (${this.discord.getUsername(playerId)}) has ${
							force ? "been forcefully dropped" : "chosen to drop"
						} from Tournament ${tournament.name} (${tournament.id}).`
					)
			)
		);
		const messages = await this.database.getRegisterMessages(tournamentId);
		for (const m of messages) {
			await this.discord.removeUserReaction(m.channelId, m.messageId, this.CHECK_EMOJI, playerId);
		}
	}

	public async syncTournament(tournamentId: string): Promise<void> {
		const tournamentData = await this.website.getTournament(tournamentId);
		await this.database.synchronise(tournamentId, {
			name: tournamentData.name,
			description: tournamentData.desc,
			players: tournamentData.players.map(({ challongeId, discordId }) => ({ challongeId, discordId }))
		});
	}

	// utility function, can be moved elsewhere if it turns out to be more universally useful
	// copied from ydeck/counts.ts, doesn't seem in-scope to expose it
	private countStrings(list: string[]): { [element: string]: number } {
		return list.reduce<{ [element: string]: number }>((acc, curr) => {
			acc[curr] = (acc[curr] || 0) + 1;
			return acc;
		}, {});
	}

	public async generatePieChart(tournamentId: string): Promise<DiscordAttachmentOut> {
		const tournament = await this.database.getTournament(tournamentId);
		// TODO: yikes
		const themes = tournament.players.map(player => {
			const deck = getDeck(player.deck);
			return deck.themes.length > 0 ? deck.themes.join("/") : "No themes";
		});
		const counts = this.countStrings(themes);
		const rows = Object.entries(counts).map(e => [e[0], e[1].toString()]);
		rows.unshift(["Theme", "Count"]);
		const contents = await csv.writeToString(rows);
		return {
			filename: `${tournament.name} Pie.csv`,
			contents
		};
	}

	public async generateDeckDump(tournamentId: string): Promise<DiscordAttachmentOut> {
		const tournament = await this.database.getTournament(tournamentId);
		// TODO: yikes
		const rows = tournament.players.map(player => {
			const deck = getDeck(player.deck);
			return [
				this.discord.getUsername(player.discordId),
				`Main: ${deck.mainText}, Extra: ${deck.extraText}, Side: ${deck.sideText}`.replace(/\n/g, ", ")
			];
		});
		rows.unshift(["Player", "Deck"]);
		const contents = await csv.writeToString(rows);
		return {
			filename: `${tournament.name} Decks.csv`,
			contents
		};
	}

	public async registerBye(tournamentId: string, playerId: string): Promise<string[]> {
		const tournament = await this.database.registerBye(tournamentId, playerId);
		return tournament.byes;
	}

	public async removeBye(tournamentId: string, playerId: string): Promise<string[]> {
		const tournament = await this.database.removeBye(tournamentId, playerId);
		return tournament.byes;
	}
}
