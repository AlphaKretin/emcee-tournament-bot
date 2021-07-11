import { getConnection, IsNull, Not } from "typeorm";
import { CardVector } from "ydeck";
import {
	AssertStatusError,
	TournamentNotFoundError,
	UnauthorisedHostError,
	UnauthorisedPlayerError,
	UserError
} from "../util/errors";
import { getLogger } from "../util/logger";
import {
	DatabaseMessage,
	DatabasePlayer,
	DatabasePlayerWithTournament,
	DatabaseTournament,
	SynchroniseTournament,
	TournamentFormat,
	TournamentStatus
} from "./interface";
import { ChallongeTournament, ConfirmedParticipant, initializeConnection, Participant, RegisterMessage } from "./orm";

const logger = getLogger("postgres");

export class DatabaseWrapperPostgres {
	private wrap(tournament: ChallongeTournament): DatabaseTournament {
		return {
			id: tournament.tournamentId,
			name: tournament.name,
			description: tournament.description,
			format: tournament.format,
			status: tournament.status,
			hosts: tournament.hosts.slice(),
			players: tournament.confirmed.map(p => ({
				discordId: p.discordId,
				challongeId: p.challongeId,
				deck: p.deck
			})),
			publicChannels: tournament.publicChannels.slice(),
			privateChannels: tournament.privateChannels.slice(),
			server: tournament.owningDiscordServer,
			byes: tournament.confirmed.filter(p => p.hasBye).map(p => p.discordId),
			allowVector: tournament.allowVector,
			findPlayer: (id: string): DatabasePlayer => {
				const p = tournament.confirmed.find(p => p.discordId === id);
				if (!p) {
					throw new UnauthorisedPlayerError(id, tournament.tournamentId);
				}
				return {
					discordId: p.discordId,
					challongeId: p.challongeId,
					deck: p.deck
				};
			}
		};
	}

	async createTournament(
		hostId: string,
		serverId: string,
		tournamentId: string,
		name: string,
		description: string,
		topCut = false
	): Promise<DatabaseTournament> {
		const tournament = new ChallongeTournament();
		tournament.tournamentId = tournamentId;
		tournament.name = name;
		tournament.description = description;
		tournament.owningDiscordServer = serverId;
		if (topCut) {
			tournament.format = TournamentFormat.SINGLE_ELIMINATION;
		}
		tournament.hosts = [hostId];
		// This is known but TypeORM won't populate it as it wasn't part of the original query,
		// which means wrap would break since it assumes not null.
		tournament.confirmed = [];
		await tournament.save();
		return this.wrap(tournament);
	}

	// This wrapper is only needed because the exception class is part of the call signature
	private async findTournament(tournamentId: string, relations: string[] = []): Promise<ChallongeTournament> {
		try {
			return await ChallongeTournament.findOneOrFail(tournamentId, { relations });
		} catch (err) {
			throw new TournamentNotFoundError(tournamentId);
		}
	}

	// TODO: remove and replace with alternate implementation
	// This causes many unnecessary double queries
	public async authenticateHost(
		tournamentId: string,
		hostId: string,
		serverId?: string,
		assertStatus?: TournamentStatus
	): Promise<DatabaseTournament> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.owningDiscordServer !== serverId) {
			throw new TournamentNotFoundError(tournamentId);
		}
		if (!tournament.hosts.includes(hostId)) {
			throw new UnauthorisedHostError(hostId, tournamentId);
		}
		if (assertStatus && tournament.status !== assertStatus) {
			throw new AssertStatusError(tournamentId, assertStatus, tournament.status);
		}
		return this.wrap(tournament);
	}

	// TODO: remove and replace with alternate implementation
	// This causes many unnecessary double queries
	public async authenticatePlayer(
		tournamentId: string,
		discordId: string,
		serverId?: string,
		assertStatus?: TournamentStatus
	): Promise<DatabasePlayerWithTournament> {
		try {
			// eslint-disable-next-line no-var
			var participant = await ConfirmedParticipant.findOneOrFail(
				{ discordId, tournamentId },
				{ relations: ["tournament"] }
			);
		} catch {
			throw new UnauthorisedPlayerError(discordId, tournamentId);
		}
		if (serverId && serverId !== participant.tournament.owningDiscordServer) {
			throw new TournamentNotFoundError(tournamentId);
		}
		if (assertStatus && participant.tournament.status !== assertStatus) {
			throw new AssertStatusError(tournamentId, assertStatus, participant.tournament.status);
		}
		return {
			challongeId: participant.challongeId,
			tournament: {
				name: participant.tournament.name,
				privateChannels: participant.tournament.privateChannels
			}
		};
	}

	async getTournament(tournamentId: string, assertStatus?: TournamentStatus): Promise<DatabaseTournament> {
		const tournament = await this.findTournament(tournamentId);
		if (assertStatus && tournament.status !== assertStatus) {
			throw new AssertStatusError(tournamentId, assertStatus, tournament.status);
		}
		return this.wrap(tournament);
	}

	async updateTournament(tournamentId: string, name: string, desc: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.status !== TournamentStatus.PREPARING) {
			throw new AssertStatusError(tournamentId, TournamentStatus.PREPARING, tournament.status);
		}
		tournament.name = name;
		tournament.description = desc;
		await tournament.save();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
	async setAllowVector(tournamentId: string, raw: any): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.status !== TournamentStatus.PREPARING) {
			throw new AssertStatusError(tournamentId, TournamentStatus.PREPARING, tournament.status);
		}
		if (Array.isArray(raw)) {
			if (
				raw.every(
					e => Array.isArray(e) && e.length === 2 && typeof e[0] === "number" && typeof e[1] === "number"
				)
			) {
				tournament.allowVector = new Map(raw);
			} else {
				throw new TypeError("Bad entries-list format for CardVector.");
			}
		} else {
			const allowVector: CardVector = new Map();
			for (const password in raw) {
				const key = Number(password);
				if (isNaN(key) || typeof raw[password] !== "number") {
					throw new TypeError("Bad object format for CardVector.");
				}
				allowVector.set(Number(password), raw[password]);
			}
			tournament.allowVector = allowVector;
		}
		await tournament.save();
	}

	async addAnnouncementChannel(tournamentId: string, channelId: string, type: "public" | "private"): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		const channels = type === "public" ? tournament.publicChannels : tournament.privateChannels;
		if (channels.includes(channelId)) {
			throw new UserError(`Tournament ${tournamentId} already has Channel ${channelId} as a ${type} channel!`);
		}
		channels.push(channelId);
		await tournament.save();
	}

	async removeAnnouncementChannel(
		tournamentId: string,
		channelId: string,
		type: "public" | "private"
	): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		const channels = type === "public" ? tournament.publicChannels : tournament.privateChannels;
		const i = channels.indexOf(channelId);
		if (i < 0) {
			throw new UserError(
				`Channel ${channelId} is not a ${type} announcement channel for Tournament ${tournamentId}!`
			);
		}
		channels.splice(i, 1);
		await tournament.save();
	}

	async addHost(tournamentId: string, newHost: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.hosts.includes(newHost)) {
			throw new UserError(`Tournament ${tournamentId} already includes user ${newHost} as a host!`);
		}
		tournament.hosts.push(newHost);
		await tournament.save();
	}

	async removeHost(tournamentId: string, newHost: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.hosts.length < 2) {
			throw new UserError(`Tournament ${tournamentId} has too few hosts to remove one!`);
		}
		if (!tournament.hosts.includes(newHost)) {
			throw new UserError(`Tournament ${tournamentId} doesn't include user ${newHost} as a host!`);
		}
		const i = tournament.hosts.indexOf(newHost);
		// i < 0 is impossible by precondition
		tournament.hosts.splice(i, 1);
		await tournament.save();
	}

	async openRegistration(tournamentId: string, channelId: string, messageId: string): Promise<void> {
		const message = new RegisterMessage();
		message.tournamentId = tournamentId;
		message.channelId = channelId;
		message.messageId = messageId;
		await message.save();
	}

	async getRegisterMessages(tournamentId?: string): Promise<DatabaseMessage[]> {
		if (!tournamentId) {
			const messages = await RegisterMessage.find();
			return messages.map(m => ({
				channelId: m.channelId,
				messageId: m.messageId
			}));
		}
		const tournament = await this.findTournament(tournamentId, ["registerMessages"]);
		return tournament.registerMessages.map(m => ({
			channelId: m.channelId,
			messageId: m.messageId
		}));
	}

	async cleanRegistration(channelId: string, messageId: string): Promise<void> {
		const message = await RegisterMessage.findOne({ channelId, messageId });
		if (!message) {
			return; // failure is OK
		}
		await message.remove();
	}

	async getPendingTournaments(playerId: string): Promise<DatabaseTournament[]> {
		const list = await Participant.find({ where: { discordId: playerId }, relations: ["tournament"] });
		return list.filter(p => !p.confirmed).map(p => this.wrap(p.tournament));
	}

	async getConfirmedTournaments(playerId: string): Promise<DatabaseTournament[]> {
		const list = await ConfirmedParticipant.find({ where: { discordId: playerId }, relations: ["tournament"] });
		return list.filter(p => p.tournament.status === TournamentStatus.PREPARING).map(p => this.wrap(p.tournament));
	}

	async addPendingPlayer(
		channelId: string,
		messageId: string,
		playerId: string
	): Promise<DatabaseTournament | undefined> {
		const message = await RegisterMessage.findOne({ channelId, messageId });
		if (!message || message.tournament.status !== TournamentStatus.PREPARING) {
			return;
		}
		if (!(await Participant.findOne({ tournamentId: message.tournamentId, discordId: playerId }))) {
			const participant = new Participant();
			participant.tournamentId = message.tournamentId;
			participant.discordId = playerId;
			await participant.save();
			return this.wrap(message.tournament);
		}
	}

	/**
	 * Called before startTournament to delete register messages and drop any pending players.
	 * We don't update the tournament status here so we can retry if something on the Challonge
	 * end goes awry.
	 *
	 * @param tournamentId
	 */
	async prestartTournament(
		tournamentId: string
	): Promise<{ registerMessages: DatabaseMessage[]; ejected: string[] }> {
		return await getConnection().transaction(async entityManager => {
			logger.verbose(`prestartTournament: ${tournamentId} transaction`);
			const registerMessageEntities = await entityManager.getRepository(RegisterMessage).find({ tournamentId });
			const registerMessages = registerMessageEntities.map(m => ({
				channelId: m.channelId,
				messageId: m.messageId
			}));
			logger.verbose(`prestartTournament: removing ${registerMessages.length} register messages`);
			for (const message of registerMessageEntities) {
				await entityManager.remove(message);
			}
			logger.verbose(`prestartTournament: searching for pending participants`);
			const participants = await entityManager.getRepository(Participant).find({ tournamentId });
			logger.verbose(`prestartTournament: loaded ${participants.length} participants for ${tournamentId}`);
			const ejectEntities = participants.filter(p => !p.confirmed);
			const ejected = ejectEntities.map(p => p.discordId);
			logger.verbose(`prestartTournament: filtered ${ejected.length} unconfirmed to eject from ${tournamentId}`);
			for (const participant of ejectEntities) {
				await entityManager.remove(participant);
			}
			logger.verbose(`prestartTournament: ${tournamentId} done`);
			return { registerMessages, ejected };
		});
	}

	async startTournament(tournamentId: string): Promise<void> {
		await getConnection()
			.createQueryBuilder()
			.update(ChallongeTournament)
			.set({
				status: TournamentStatus.IPR
			})
			.where("tournamentId = :tournamentId", { tournamentId })
			.execute();
	}

	async finishTournament(tournamentId: string): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		tournament.status = TournamentStatus.COMPLETE;
		await tournament.save();
	}

	async confirmPlayer(tournamentId: string, playerId: string, challongeId: number, deck: string): Promise<void> {
		let participant = await Participant.findOne({ tournamentId, discordId: playerId });
		await getConnection().transaction(async entityManager => {
			if (!participant) {
				participant = new Participant();
				participant.tournamentId = tournamentId;
				participant.discordId = playerId;
				await entityManager.save(participant);
			}
			if (!participant.confirmed) {
				participant.confirmed = new ConfirmedParticipant();
				participant.confirmed.tournamentId = tournamentId;
				participant.confirmed.discordId = playerId;
				participant.confirmed.challongeId = challongeId;
			}
			participant.confirmed.deck = deck;
			await entityManager.save(participant.confirmed);
			await entityManager.save(participant);
		});
	}

	async updateDeck(tournamentId: string, discordId: string, deck: string): Promise<void> {
		await ConfirmedParticipant.createQueryBuilder()
			.update()
			.set({ deck })
			.where({ tournamentId, discordId })
			.execute();
	}

	async getActiveTournaments(server?: string): Promise<DatabaseTournament[]> {
		const owningDiscordServer = server || Not(IsNull());
		const tournaments = await ChallongeTournament.find({
			where: [
				{ owningDiscordServer, status: TournamentStatus.IPR },
				{ owningDiscordServer, status: TournamentStatus.PREPARING }
			]
		});
		return tournaments.map(t => this.wrap(t));
	}

	async synchronise(tournamentId: string, newData: SynchroniseTournament): Promise<void> {
		const tournament = await this.findTournament(tournamentId);
		await getConnection().transaction(async entityManager => {
			tournament.name = newData.name;
			tournament.description = newData.description;
			await entityManager.save(tournament);

			for (const newPlayer of newData.players) {
				if (!tournament.confirmed.find(p => p.challongeId === newPlayer.challongeId)) {
					const participant = new Participant();
					participant.tournamentId = tournamentId;
					participant.discordId = newPlayer.discordId;
					await entityManager.save(participant);
					participant.confirmed = new ConfirmedParticipant();
					participant.confirmed.tournamentId = tournamentId;
					participant.confirmed.discordId = newPlayer.discordId;
					participant.confirmed.challongeId = newPlayer.challongeId;
					participant.confirmed.deck = "ydke://!!!";
					await entityManager.save(participant.confirmed);
					await entityManager.save(participant);
				}
			}
		});
	}

	/// @throws {TournamentNotFoundError}
	/// @throws {AssertStatusError}
	/// @throws {EntityNotFoundError}
	private async byeHelper(
		tournamentId: string,
		playerId: string,
		operation: (participant: ConfirmedParticipant) => Promise<void>
	): Promise<string[]> {
		const tournament = await this.findTournament(tournamentId);
		if (tournament.status !== TournamentStatus.PREPARING) {
			throw new AssertStatusError(tournamentId, TournamentStatus.PREPARING, tournament.status);
		}
		const participant = await ConfirmedParticipant.findOneOrFail({ tournamentId, discordId: playerId });
		await operation(participant);
		await participant.save();
		const byes = await ConfirmedParticipant.find({ tournamentId, hasBye: true });
		return byes.map(p => p.discordId);
	}

	async registerBye(tournamentId: string, playerId: string): Promise<string[]> {
		return await this.byeHelper(tournamentId, playerId, async participant => {
			if (participant.hasBye) {
				throw new UserError(`Player ${playerId} already has a bye in Tournament ${tournamentId}`);
			}
			participant.hasBye = true;
		});
	}

	async removeBye(tournamentId: string, playerId: string): Promise<string[]> {
		return await this.byeHelper(tournamentId, playerId, async participant => {
			if (!participant.hasBye) {
				throw new UserError(`Player ${playerId} does not have a bye in Tournament ${tournamentId}`);
			}
			participant.hasBye = false;
		});
	}

	async getConfirmed(tournamentId: string): Promise<DatabasePlayer[]> {
		return await ConfirmedParticipant.find({ tournamentId });
	}

	async getConfirmedPlayer(discordId: string, tournamentId: string): Promise<DatabasePlayer> {
		const p = await ConfirmedParticipant.findOneOrFail({ discordId, tournamentId });
		return {
			discordId: p.discordId,
			challongeId: p.challongeId,
			deck: p.deck
		};
	}

	async getPlayerByChallonge(challongeId: number, tournamentId: string): Promise<DatabasePlayer> {
		const p = await ConfirmedParticipant.findOneOrFail({ challongeId, tournamentId });
		return {
			discordId: p.discordId,
			challongeId: p.challongeId,
			deck: p.deck
		};
	}
}

export async function initializeDatabase(postgresqlUrl: string): Promise<DatabaseWrapperPostgres> {
	await initializeConnection(postgresqlUrl);
	return new DatabaseWrapperPostgres();
}
