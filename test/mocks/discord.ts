import {
	DiscordAttachmentOut,
	DiscordDeleteHandler,
	DiscordMessageHandler,
	DiscordMessageIn,
	DiscordMessageOut,
	DiscordMessageSent,
	DiscordWrapper
} from "../../src/discord/interface";
import { UserError } from "../../src/errors";

export class DiscordWrapperMock implements DiscordWrapper {
	private messageHandlers: DiscordMessageHandler[];
	private pingHandlers: DiscordMessageHandler[];
	private deleteHandlers: DiscordDeleteHandler[];

	private messages: { [channel: string]: DiscordMessageOut };
	private files: { [channel: string]: DiscordAttachmentOut };
	private emoji: { [message: string]: string };
	constructor() {
		this.messageHandlers = [];
		this.pingHandlers = [];
		this.deleteHandlers = [];

		this.messages = {};
		this.files = {};
		this.emoji = {};
	}

	public async simMessage(content: string, testCode: string): Promise<void> {
		await this.messageHandlers[0]({
			id: "testId",
			content: content,
			attachments: [],
			author: "testUser",
			channel: "testChannel",
			server: "testServer",
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

	public async simPing(testCode: string): Promise<void> {
		await this.pingHandlers[0]({
			id: "testId",
			content: "@you",
			attachments: [],
			author: "testUser",
			channel: "testChannel",
			server: "testServer",
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
		channel: string,
		msg: DiscordMessageOut,
		file?: DiscordAttachmentOut
	): Promise<DiscordMessageSent> {
		this.messages[channel] = msg;
		if (file) {
			this.files[channel] = file;
		}
		return {
			id: "testId",
			content: typeof msg === "string" ? msg : "embed",
			attachments: [],
			author: "you",
			channel: channel,
			server: "testServer",
			reply: async (msg: DiscordMessageOut, file?: DiscordAttachmentOut): Promise<void> => {
				this.messages[channel] = msg;
				if (file) {
					this.files[channel] = file;
				}
			},
			react: async (emoji: string): Promise<void> => {
				this.emoji[channel] = emoji;
			},
			edit: async (newMsg: DiscordMessageOut): Promise<void> => {
				this.messages[channel] = newMsg;
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

	public async authenticateTO(): Promise<void> {
		// if implemented properly would throw error if not authenticated
		// but for these unit tests we will assume authentication
		return;
	}

	public getMentionedUser(m: DiscordMessageIn): string {
		const mentionReg = /<@(.+)>/;
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
		this.messages[userId] = content;
	}
}
