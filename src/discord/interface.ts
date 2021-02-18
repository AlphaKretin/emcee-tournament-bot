export interface DiscordAttachmentIn {
	filename: string;
	url: string;
}

export interface DiscordMessageIn {
	id: string;
	content: string;
	attachments: DiscordAttachmentIn[];
	author: string;
	channelId: string;
	serverId: string;
	reply: (msg: DiscordMessageOut, file?: DiscordAttachmentOut) => Promise<void>;
	react: (emoji: string) => Promise<void>;
	edit: (newMsg: DiscordMessageOut) => Promise<void>;
}

export interface DiscordMessageLimited {
	id: string;
	channelId: string;
}

export type DiscordMessageOut = string | DiscordEmbed;

export type DiscordMessageSent = DiscordMessageIn; // same properties, different use

export interface DiscordEmbed {
	title: string;
	fields: DiscordEmbedField[];
}

interface DiscordEmbedField {
	name: string;
	value: string;
}

export interface DiscordAttachmentOut {
	filename: string;
	contents: string;
}

export type DiscordDeleteHandler = (msg: DiscordMessageLimited) => Promise<void> | void;

type DiscordReactionResponse = (msg: DiscordMessageIn, userId: string) => Promise<void> | void;

export interface DiscordReactionHandler {
	msg: string;
	emoji: string;
	response: DiscordReactionResponse;
}

export interface DiscordWrapper {
	onDelete: (handler: DiscordDeleteHandler) => void;
	onReaction: (handler: DiscordReactionHandler) => void;
	onReactionRemove: (handler: DiscordReactionHandler) => void;
	removeUserReaction: (channelId: string, messageId: string, emoji: string, userId: string) => Promise<boolean>;
	getMessage(channelId: string, messageId: string): Promise<DiscordMessageIn | null>;
	sendMessage(channelId: string, msg: DiscordMessageOut, file?: DiscordAttachmentOut): Promise<DiscordMessageSent>;
	deleteMessage(channelId: string, messageId: string): Promise<void>;
	getUsername(userId: string): string;
	getRESTUsername(userId: string): Promise<string | null>;
	sendDirectMessage(userId: string, content: DiscordMessageOut): Promise<void>;
	isUserInGuild(userId: string, guildId: string): Promise<boolean>;
}

export class DiscordInterface {
	private api: DiscordWrapper;
	constructor(api: DiscordWrapper) {
		this.api = api;
	}

	public onDelete(func: DiscordDeleteHandler): void {
		this.api.onDelete(func);
	}

	public async awaitReaction(
		content: DiscordMessageOut,
		channelId: string,
		emoji: string,
		response: DiscordReactionResponse,
		removeResponse: DiscordReactionResponse
	): Promise<DiscordMessageSent> {
		const msg = await this.sendMessage(channelId, content);
		await msg.react(emoji);
		this.api.onReaction({ msg: msg.id, emoji, response });
		this.api.onReactionRemove({ msg: msg.id, emoji, response: removeResponse });
		return msg;
	}

	public restoreReactionButton(
		msg: DiscordMessageIn,
		emoji: string,
		response: DiscordReactionResponse,
		removeResponse: DiscordReactionResponse
	): void {
		this.api.onReaction({ msg: msg.id, emoji, response });
		this.api.onReactionRemove({ msg: msg.id, emoji, response: removeResponse });
	}

	public async removeUserReaction(
		channelId: string,
		messageId: string,
		emoji: string,
		userId: string
	): Promise<boolean> {
		return await this.api.removeUserReaction(channelId, messageId, emoji, userId);
	}

	public mentionUser(userId: string): string {
		return `<@${userId}>`;
	}

	public mentionRole(roleId: string): string {
		return `<@&${roleId}>`;
	}

	public async getMessage(channelId: string, messageId: string): Promise<DiscordMessageIn | null> {
		return await this.api.getMessage(channelId, messageId);
	}

	public async sendMessage(
		channelId: string,
		msg: DiscordMessageOut,
		file?: DiscordAttachmentOut
	): Promise<DiscordMessageSent> {
		return await this.api.sendMessage(channelId, msg, file);
	}

	public async deleteMessage(channelId: string, messageId: string): Promise<void> {
		await this.api.deleteMessage(channelId, messageId);
	}

	public getUsername(userId: string): string {
		return this.api.getUsername(userId);
	}

	public async getRESTUsername(userId: string): Promise<string | null> {
		return await this.api.getRESTUsername(userId);
	}

	public async sendDirectMessage(userId: string, content: DiscordMessageOut): Promise<void> {
		await this.api.sendDirectMessage(userId, content);
	}

	public async isUserInGuild(userId: string, guildId: string): Promise<boolean> {
		return await this.api.isUserInGuild(userId, guildId);
	}
}

// utility function relevant for Discord message caps
export function splitText(outString: string, cap = 2000): string[] {
	const outStrings: string[] = [];
	while (outString.length > cap) {
		let index = outString.slice(0, cap).lastIndexOf("\n");
		if (index === -1 || index >= cap) {
			index = outString.slice(0, cap).lastIndexOf(".");
			if (index === -1 || index >= cap) {
				index = outString.slice(0, cap).lastIndexOf(" ");
				if (index === -1 || index >= cap) {
					index = cap - 1;
				}
			}
		}
		outStrings.push(outString.slice(0, index + 1));
		outString = outString.slice(index + 1);
	}
	outStrings.push(outString);
	return outStrings;
}
