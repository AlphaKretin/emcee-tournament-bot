import { CommandDefinition } from "../Command";
import { firstMentionOrFail, reply } from "../util/discord";
import { getLogger } from "../util/logger";

const logger = getLogger("command:removebye");

const command: CommandDefinition = {
	name: "removebye",
	requiredArgs: ["id"],
	executor: async (msg, args, support) => {
		// Mirror of addbye
		const [id] = args;
		await support.database.authenticateHost(id, msg.author.id, msg.guildID);
		const player = firstMentionOrFail(msg);
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "removebye",
				mention: player,
				event: "attempt"
			})
		);
		const byes = await support.database.removeBye(id, player);
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "removebye",
				mention: player,
				event: "success"
			})
		);
		const tag = (id: string): string =>
			`${support.discord.mentionUser(id)} (${support.discord.getUsername(id, true)})`;
		const names = byes.map(tag).join(", ");
		await reply(msg, `Bye removed for Player ${tag(player)} in Tournament ${id}!\nAll byes: ${names}`);
	}
};

export default command;
