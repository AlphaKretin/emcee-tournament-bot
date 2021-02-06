import { CommandDefinition } from "../Command";
import { reply } from "../util/discord";
import { getLogger } from "../util/logger";

const logger = getLogger("command:addchannel");

const command: CommandDefinition = {
	name: "addchannel",
	requiredArgs: ["id"],
	executor: async (msg, args, support) => {
		const [id, baseType] = args; // 1 optional and thus potentially undefined
		await support.tournamentManager.authenticateHost(id, msg.author.id);
		const type = baseType?.toLowerCase() === "private" ? "private" : "public";
		const channelId = msg.channel.id;
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "addchannel",
				type,
				// destination: channelId, // no longer necessary as must === channel
				event: "attempt"
			})
		);
		await support.tournamentManager.addAnnouncementChannel(id, channelId, type);
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				tournament: id,
				command: "addchannel",
				type,
				// destination: channelId,
				event: "success"
			})
		);
		/* No longer required as will always be in same channel as reply
		await reply(
			msg,
			`${support.discord.mentionChannel(channelId)} added as a ${type} announcement channel for Tournament ${id}!`
		);
		*/
		await reply(msg, `This channel added as a ${type} announcement channel for Tournament ${id}!`);
	}
};

export default command;
