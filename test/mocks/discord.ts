import {
	DiscordAttachmentOut,
	DiscordDeleteHandler,
	DiscordMessageHandler,
	DiscordMessageIn,
	DiscordMessageOut,
	DiscordMessageSent,
	DiscordWrapper
} from "../../src/discord/interface";
import { BlockedDMsError, UserError } from "../../src/util/errors";

export class DiscordWrapperMock implements DiscordWrapper {
	private messageHandlers: DiscordMessageHandler[];
	private pingHandlers: DiscordMessageHandler[];
	private deleteHandlers: DiscordDeleteHandler[];

	private messages: { [channelId: string]: DiscordMessageOut };
	private files: { [channelId: string]: DiscordAttachmentOut };
	private emoji: { [messageId: string]: string };
	constructor() {
		this.messageHandlers = [];
		this.pingHandlers = [];
		this.deleteHandlers = [];

		this.messages = {};
		this.files = {};
		this.emoji = {};
	}

	public async simMessage(content: string, testCode: string): Promise<void> {
		for (const handler of this.messageHandlers) {
			await handler({
				id: "testId",
				content: content,
				attachments: [],
				author: "testUser",
				channelId: "testChannel",
				serverId: "testServer",
				reply: async (msg: DiscordMessageOut, file?: DiscordAttachmentOut) => {
					this.messages[testCode] = msg;
					if (file) {
						this.files[testCode] = file;
					}
				},
				react: async (emoji: string) => {
					this.emoji[testCode] = emoji;
				},
				edit: async (newMsg: DiscordMessageOut): Promise<void> => {
					this.messages[testCode] = newMsg;
				}
			});
		}
	}

	public async simPing(testCode: string): Promise<void> {
		await this.pingHandlers[0]({
			id: "testId",
			content: "@you",
			attachments: [],
			author: "testUser",
			channelId: "testChannel",
			serverId: "testServer",
			reply: async (msg: DiscordMessageOut) => {
				this.messages[testCode] = msg;
			},
			react: async (emoji: string) => {
				this.emoji[testCode] = emoji;
			},
			edit: async (newMsg: DiscordMessageOut): Promise<void> => {
				this.messages[testCode] = newMsg;
			}
		});
	}

	public getResponse(testCode: string): DiscordMessageOut | undefined {
		return this.messages[testCode];
	}

	public getFile(testCode: string): DiscordAttachmentOut | undefined {
		return this.files[testCode];
	}

	public getEmoji(testCode: string): string | undefined {
		return this.emoji[testCode];
	}

	public async sendMessage(
		channelId: string,
		msg: DiscordMessageOut,
		file?: DiscordAttachmentOut
	): Promise<DiscordMessageSent> {
		this.messages[channelId] = msg;
		if (file) {
			this.files[channelId] = file;
		}
		return {
			id: "testId",
			content: typeof msg === "string" ? msg : "embed",
			attachments: [],
			author: "you",
			channelId: channelId,
			serverId: "testServer",
			reply: async (msg: DiscordMessageOut, file?: DiscordAttachmentOut): Promise<void> => {
				this.messages[channelId] = msg;
				if (file) {
					this.files[channelId] = file;
				}
			},
			react: async (emoji: string): Promise<void> => {
				this.emoji[channelId] = emoji;
			},
			edit: async (newMsg: DiscordMessageOut): Promise<void> => {
				this.messages[channelId] = newMsg;
			}
		};
	}

	public async deleteMessage(): Promise<void> {
		return;
	}

	public async getPlayerRole(): Promise<string> {
		return "role";
	}

	public async grantPlayerRole(): Promise<void> {
		return;
	}

	public async removePlayerRole(): Promise<void> {
		return;
	}

	public async deletePlayerRole(): Promise<void> {
		return;
	}

	public onMessage(handler: DiscordMessageHandler): void {
		this.messageHandlers.push(handler);
	}

	public onDelete(handler: DiscordDeleteHandler): void {
		this.deleteHandlers.push(handler);
	}

	public onPing(handler: DiscordMessageHandler): void {
		this.pingHandlers.push(handler);
	}

	public onReaction(): void {
		return; // out of scope for these tests
	}

	public onReactionRemove(): void {
		return; // out of scope for these tests
	}

	public async removeUserReaction(): Promise<boolean> {
		return true;
	}

	public async authenticateTO(): Promise<void> {
		// if implemented properly would throw error if not authenticated
		// but for these unit tests we will assume authentication
		return;
	}

	public getMentionedUser(m: DiscordMessageIn): string {
		const mentionReg = /<@(.+?)>/;
		const result = mentionReg.exec(m.content);
		if (!result) {
			throw new UserError("User not found in message!");
		}
		return result[1];
	}

	public getUsername(userId: string): string {
		return userId;
	}

	public async sendDirectMessage(userId: string, content: DiscordMessageOut): Promise<void> {
		if (userId.startsWith("block")) {
			throw new BlockedDMsError(userId);
		}
		this.messages[userId] = content;
	}
}
