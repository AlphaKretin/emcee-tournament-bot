import {
	Client,
	Emoji,
	GuildChannel,
	Member,
	Message,
	MessageContent,
	MessageFile,
	PossiblyUncachedMessage,
	TextChannel
} from "eris";
import { AssertTextChannelError, BlockedDMsError } from "../util/errors";
import { getLogger } from "../util/logger";
import {
	DiscordAttachmentOut,
	DiscordDeleteHandler,
	DiscordMessageIn,
	DiscordMessageLimited,
	DiscordMessageOut,
	DiscordMessageSent,
	DiscordReactionHandler,
	DiscordWrapper
} from "./interface";

const logger = getLogger("eris");

export class DiscordWrapperEris implements DiscordWrapper {
	private reactionHandlers: DiscordReactionHandler[];
	private reactionRemoveHandlers: DiscordReactionHandler[];
	private deleteHandlers: DiscordDeleteHandler[];

	constructor(private bot: Client) {
		this.deleteHandlers = [];
		this.reactionHandlers = [];
		this.reactionRemoveHandlers = [];
		this.bot.on("messageReactionAdd", this.handleReaction.bind(this));
		this.bot.on("messageReactionRemove", this.handleReactionRemove.bind(this));
		this.bot.on("messageDelete", this.handleDelete.bind(this));
	}

	private wrapMessageIn(msg: Message): DiscordMessageIn {
		const channel = msg.channel;
		const guildId = channel instanceof GuildChannel ? channel.guild.id : "private";
		return {
			id: msg.id,
			attachments: msg.attachments,
			content: msg.content,
			author: msg.author.id,
			channelId: channel.id,
			serverId: guildId,
			reply: async (out: DiscordMessageOut, file?: DiscordAttachmentOut): Promise<void> => {
				await msg.channel.createMessage(this.unwrapMessageOut(out), this.unwrapFileOut(file));
			},
			react: async (emoji: string): Promise<void> => {
				await msg.addReaction(emoji);
			},
			edit: async (newMsg: DiscordMessageOut): Promise<void> => {
				await msg.edit(this.unwrapMessageOut(newMsg));
			}
		};
	}

	private unwrapMessageOut(msg: DiscordMessageOut): MessageContent {
		if (typeof msg === "string") {
			return msg;
		}
		// else embed
		return { embed: msg };
	}

	private unwrapFileOut(file?: DiscordAttachmentOut): MessageFile | undefined {
		return file ? { file: file.contents, name: file.filename } : undefined;
	}

	public async getMessage(channelId: string, messageId: string): Promise<DiscordMessageIn | null> {
		try {
			const msg = await this.bot.getMessage(channelId, messageId);
			return this.wrapMessageIn(msg);
		} catch (err) {
			// unknown message
			if (err.code === 10008) {
				return null;
			}
			throw err;
		}
	}

	public async sendMessage(
		channelId: string,
		msg: DiscordMessageOut,
		file?: DiscordAttachmentOut
	): Promise<DiscordMessageSent> {
		const out = this.unwrapMessageOut(msg);
		const outFile = this.unwrapFileOut(file);
		const chan = this.bot.getChannel(channelId);
		if (chan instanceof TextChannel) {
			const response = await chan.createMessage(out, outFile);
			return this.wrapMessageIn(response);
		}
		throw new AssertTextChannelError(channelId);
	}

	public async deleteMessage(channelId: string, messageId: string): Promise<void> {
		await this.bot.deleteMessage(channelId, messageId);
	}

	private wrapMessageLimited(msg: PossiblyUncachedMessage): DiscordMessageLimited {
		return {
			channelId: msg.channel.id,
			id: msg.id
		};
	}

	private async handleDelete(msg: PossiblyUncachedMessage): Promise<void> {
		// clean reactions
		this.reactionHandlers = this.reactionHandlers.filter(h => !(h.msg === msg.id));
		for (const handler of this.deleteHandlers) {
			await handler(this.wrapMessageLimited(msg));
		}
	}

	private async handleReaction(msg: PossiblyUncachedMessage, emoji: Emoji, member: Member): Promise<void> {
		if (member.id === this.bot.user.id) {
			return;
		}
		const fullMsg = await this.bot.getMessage(msg.channel.id, msg.id);
		const handlers = this.reactionHandlers.filter(h => h.msg === msg.id && h.emoji === emoji.name);
		for (const handler of handlers) {
			// TODO: move error handling to interface like for messages
			// or just wait until we redo this whole interface/wrapper system
			try {
				await handler.response(this.wrapMessageIn(fullMsg), member.id);
			} catch (e) {
				// no errors arising here should concern the user directly,
				// any procedural issues should be handled by a message, not throwing
				logger.error(e);
			}
		}
	}

	private async handleReactionRemove(msg: PossiblyUncachedMessage, emoji: Emoji, userId: string): Promise<void> {
		if (userId === this.bot.user.id) {
			return;
		}
		const fullMsg = await this.bot.getMessage(msg.channel.id, msg.id);
		const handlers = this.reactionRemoveHandlers.filter(h => h.msg === msg.id && h.emoji === emoji.name);
		for (const handler of handlers) {
			// TODO: move error handling to interface like for messages
			// or just wait until we redo this whole interface/wrapper system
			try {
				await handler.response(this.wrapMessageIn(fullMsg), userId);
			} catch (e) {
				// no errors arising here should concern the user directly,
				// any procedural issues should be handled by a message, not throwing
				logger.error(e);
			}
		}
	}

	public onDelete(handler: DiscordDeleteHandler): void {
		this.deleteHandlers.push(handler);
	}

	public onReaction(handler: DiscordReactionHandler): void {
		this.reactionHandlers.push(handler);
	}

	public onReactionRemove(handler: DiscordReactionHandler): void {
		this.reactionRemoveHandlers.push(handler);
	}

	public async removeUserReaction(
		channelId: string,
		messageId: string,
		emoji: string,
		userId: string
	): Promise<boolean> {
		const msg = await this.bot.getMessage(channelId, messageId);
		try {
			await msg.removeReaction(emoji, userId);
			return true;
		} catch (e) {
			// TODO: check for specific error for message not having the specified reaction/user
			return false;
		}
	}

	public getUsername(userId: string): string {
		const user = this.bot.users.get(userId);
		return user ? `${user.username}#${user.discriminator}` : userId;
	}

	/**
	 * Retrieves user information by the REST API if not cached.
	 */
	public async getRESTUsername(userId: string): Promise<string | null> {
		try {
			const user = this.bot.users.get(userId) || (await this.bot.getRESTUser(userId));
			return `${user.username}#${user.discriminator}`;
		} catch {
			return null;
		}
	}

	public async sendDirectMessage(userId: string, content: DiscordMessageOut): Promise<void> {
		const user = this.bot.users.get(userId) || (await this.bot.getRESTUser(userId));
		const channel = await user.getDMChannel();
		try {
			await channel.createMessage(this.unwrapMessageOut(content));
		} catch (e) {
			// DiscordRESTError - User blocking DMs
			if (e.code === 50007) {
				throw new BlockedDMsError(userId);
			}
			logger.error(e);
		}
	}

	public async isUserInGuild(userID: string, guildId: string): Promise<boolean> {
		const guild = this.bot.guilds.get(guildId);
		if (!guild) {
			// TODO: getRESTGuilds? return true as stopgap measure bc don't want to drop players carelessly
			return true;
		}
		return !!guild.members.get(userID);
	}
}
