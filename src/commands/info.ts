import { EmbedField } from "eris";
import { CommandDefinition } from "../Command";
import { ChallongeTournament } from "../database/orm";
import { reply } from "../util/discord";
import { getLogger } from "../util/logger";

const logger = getLogger("command:info");

const command: CommandDefinition = {
	name: "info",
	requiredArgs: ["id"],
	executor: async (msg, args) => {
		const [id] = args;
		if (!msg.guildID) {
			await reply(msg, `This can only be used in a server!`);
			return;
		}
		const tournament = await ChallongeTournament.findOne({
			tournamentId: id,
			owningDiscordServer: msg.guildID
		});
		if (tournament) {
			logger.verbose(
				JSON.stringify({
					channel: msg.channel.id,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "info",
					event: "found"
				})
			);
			const fields: EmbedField[] = [
				{ name: ":ticket: Capacity", value: `${tournament.participantLimit || 256}`, inline: true },
				{
					name: ":tickets: Registered",
					value: `**${tournament.confirmed.length}** participants`,
					inline: true
				},
				{ name: ":notepad_spiral: Format", value: tournament.format, inline: true },
				{ name: ":hourglass: Status", value: tournament.status, inline: true }
			];
			const byes = tournament.confirmed
				.filter(p => p.hasBye)
				.map(p => `<@${p.discordId}>`)
				.join(" ");
			if (byes) {
				fields.push({ name: ":sunglasses: Round 1 byes", value: byes, inline: true });
			}
			const hosts = tournament.hosts.map(snowflake => `<@${snowflake}>`).join(" ");
			fields.push({ name: ":smile: Hosts", value: hosts, inline: true });
			await reply(msg, {
				embed: {
					url: `https://challonge.com/${id}`,
					title: `**${tournament.name}**`,
					description: tournament.description,
					fields,
					footer: { text: "Tournament details as of request time" }
				},
				allowedMentions: { users: false }
			});
		} else {
			logger.verbose(
				JSON.stringify({
					channel: msg.channel.id,
					message: msg.id,
					user: msg.author.id,
					tournament: id,
					command: "info",
					event: "404"
				})
			);
			await reply(msg, "No matching tournament in this server.");
		}
	}
};

export default command;
