import { CommandDefinition } from "../Command";
import { TournamentStatus } from "../database/interface";
import { Participant } from "../database/orm";
import { dropPlayerChallonge } from "../drop";
import { parseUserMention, reply } from "../util/discord";
import { getLogger } from "../util/logger";

const logger = getLogger("command:forcedrop");

const command: CommandDefinition = {
	name: "forcedrop",
	requiredArgs: ["id", "who"],
	executor: async (msg, args, support) => {
		const [id, who] = args;
		const tournament = await support.database.authenticateHost(id, msg.author.id, msg.guildID);
		const player = parseUserMention(who) || who;
		function log(payload: Record<string, unknown>): void {
			logger.verbose(
				JSON.stringify({
					channel: msg.channel.id,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "forcedrop",
					...payload
				})
			);
		}
		log({ player, event: "attempt" });
		const participant = await Participant.findOne({ tournamentId: id, discordId: player });
		const username = await support.discord.getRESTUsername(player, true);
		log({ player, exists: !!participant, challongeId: participant?.confirmed?.challongeId, username });
		const name = username ? `<@${player}> (${username})` : who;
		if (!participant) {
			await reply(msg, `${name} not found in **${tournament.name}**.`);
			return;
		}
		if (tournament.status === TournamentStatus.COMPLETE) {
			log({ player, event: "already complete" });
			await reply(msg, `**${tournament.name}** has already concluded!`);
			return;
		}
		if (participant.confirmed) {
			if (
				await dropPlayerChallonge(
					id,
					tournament.privateChannels,
					tournament.status,
					participant.confirmed.challongeId,
					who,
					log,
					support.discord,
					support.challonge,
					support.database
				)
			) {
				try {
					await support.participantRole.ungrant(player, tournament);
				} catch (error) {
					logger.warn(error);
					await reply(msg, `Failed to remove **${tournament.name}** participant role from ${name}.`).catch(
						logger.error
					);
				}
			} else {
				await reply(
					msg,
					"Something went wrong. Please check private channels for problems and try again later."
				);
				return;
			}
		}
		const confirmed = !!participant.confirmed;
		try {
			await participant.remove();
		} catch (error) {
			logger.error(error);
			await reply(msg, "Something went wrong. Please check private channels for problems and try again later.");
			return;
		}
		// Notify relevant parties as long as the participant existed
		await support.discord
			.sendDirectMessage(player, `You have been dropped from **${tournament.name}** by the hosts.`)
			.catch(logger.error);
		for (const channel of tournament.privateChannels) {
			await support.discord
				.sendMessage(channel, `${name} has been forcefully dropped from **${tournament.name}**.`)
				.catch(logger.error);
		}
		await reply(
			msg,
			confirmed
				? `${name} successfully dropped from **${tournament.name}**.`
				: `${name} was pending and dropped from **${tournament.name}**.`
		);
		log({ player, event: "success" });
		const messages = await support.database.getRegisterMessages(id);
		for (const m of messages) {
			await support.discord.removeUserReaction(m.channelId, m.messageId, "✅", player);
		}
	}
};

export default command;
