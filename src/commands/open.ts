import { CommandDefinition } from "../Command";
import logger from "../util/logger";

const command: CommandDefinition = {
	name: "open",
	requiredArgs: ["id"],
	executor: async (msg, args, support) => {
		const [id] = args;
		await support.tournamentManager.authenticateHost(id, msg.author);
		await support.tournamentManager.openTournament(id);
		logger.verbose(`Tournament ${id} opened for registration by ${msg.author}.`);
		await msg.reply(`Tournament ${id} opened for registration!`);
	}
};

export default command;