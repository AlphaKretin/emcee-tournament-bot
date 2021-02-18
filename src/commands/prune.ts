import { CommandDefinition } from "../Command";
import { reply } from "../util/discord";
import { getLogger } from "../util/logger";

const logger = getLogger("command:prune");

const command: CommandDefinition = {
	name: "prune",
	requiredArgs: ["id"],
	executor: async (msg, args, support) => {
		const [id] = args;
		await support.tournamentManager.authenticateHost(id, msg.author.id);
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "prune",
				event: "attempt"
			})
		);
		const players = await support.tournamentManager.prunePlayers(id);
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "prune",
				event: "success",
				players
			})
		);
		await reply(
			msg,
			`The following players have been dropped from Tournament ${id} because they are no longer in this server:\n<@${players.join(
				">, <@"
			)}>`
		);
	}
};

export default command;
