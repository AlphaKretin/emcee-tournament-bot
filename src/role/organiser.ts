import { Guild, GuildChannel, Message } from "eris";
import { UnauthorisedTOError } from "../util/errors";
import { getLogger } from "../util/logger";

const logger = getLogger("role:organiser");

/**
 * Creates the server role that permits using the list and create commands.
 */
export class OrganiserRoleProvider {
	protected roleCache: { [serverId: string]: string } = {};

	// Using American spelling for Eris consistency
	constructor(readonly name: string, readonly color?: number) {}

	/**
	 * Creates the role in question and stores it in the internal cache.
	 * Exceptions (missing permissions, network fault) can be thrown.
	 *
	 * @param server The server to create the organiser role in
	 * @returns Discord role snowflake
	 */
	public async create(server: Guild): Promise<string> {
		const role = await server.createRole(
			{
				name: this.name,
				color: this.color
			},
			"Auto-created by Emcee."
		);
		this.roleCache[server.id] = role.id;
		logger.info(`Role ${this.name} (${role.id}) created in ${server.name} (${server.id}).`);
		return role.id;
	}

	/**
	 * Retrieve the organiser role and cache it, or create the role if it is missing.
	 * Exceptions on creation (missing permissions, network fault) can be thrown.
	 *
	 * @param server The server to retrieve or create the organiser role in
	 * @returns Discord role snowflake
	 */
	public async get(server: Guild): Promise<string> {
		if (server.id in this.roleCache) {
			return this.roleCache[server.id];
		}
		// Find already-created role and cache in memory
		const existingRole = server.roles.find(role => role.name === this.name);
		if (existingRole) {
			logger.verbose(`Cached role ${this.name} (${existingRole.id}) in ${server.name} (${server.id}).`);
			return (this.roleCache[server.id] = existingRole.id);
		}
		logger.verbose(`Cache miss for role ${this.name} in ${server.name} (${server.id}).`);
		return await this.create(server);
	}

	/**
	 * Assert that the sender of the message holds the organiser role for the server
	 * the message was sent in, or throw UnauthorisedTOError.
	 * Exceptions on role creation (missing permissions, network fault) can be thrown.
	 *
	 * @param msg The message to authorise
	 * @throws UnauthorisedTOError
	 */
	public async authorise(msg: Message): Promise<void> {
		if (!(msg.channel instanceof GuildChannel)) {
			throw new UnauthorisedTOError(msg.author.id);
		}
		const server = msg.channel.guild;
		// Since we have the provided context of a message sent to the bot, we can simply
		// use the Eris cache to get server member metadata for the message author
		const member = server.members.get(msg.author.id);
		if (!member) {
			throw new UnauthorisedTOError(msg.author.id);
		}
		const role = await this.get(server);
		if (!member.roles.includes(role)) {
			throw new UnauthorisedTOError(msg.author.id);
		}
		logger.verbose(
			JSON.stringify({
				channel: msg.channel.id,
				message: msg.id,
				user: msg.author.id,
				server: server.id,
				event: `authorised in '${server.name}'`
			})
		);
	}
}
