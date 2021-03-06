import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { DiscordInterface } from "../src/discord/interface";
import { DiscordWrapperMock } from "./mocks/discord";
chai.use(chaiAsPromised);

const discordMock = new DiscordWrapperMock();
const discord = new DiscordInterface(discordMock);

async function noop(): Promise<void> {
	return;
}

describe("Simple helpers", function () {
	it("mentionUser", function () {
		expect(discord.mentionUser("player")).to.equal("<@player>");
	});

	it("mentionRole", function () {
		expect(discord.mentionRole("role")).to.equal("<@&role>");
	});
});

describe("getUsername", function () {
	it("No special characters", function () {
		expect(discord.getUsername("player1", true)).to.equal("player1");
	});
	it("Successful escape", function () {
		expect(discord.getUsername("player_1", true)).to.equal("player\\_1");
	});
	it("Successful escape backslash", function () {
		expect(discord.getUsername("player\\1", true)).to.equal("player\\\\1");
	});
	it("There is no escape", function () {
		expect(discord.getUsername("player_1")).to.equal("player_1");
	});
});

describe("Callback setups", function () {
	it("Ignore non-command message", async function () {
		await discordMock.sendMessage("mc!pong", "pong");
		expect(discordMock.getResponse("pong")).to.be.undefined;
	});

	it("onDelete", async function () {
		// TODO: mock deletion?
		expect(() => discord.onDelete(noop)).to.not.throw;
	});

	it("awaitReaction", async function () {
		const msg = await discord.awaitReaction("reactionMessage", "pung", "😳", noop, noop);
		expect(msg.content).to.equal("reactionMessage");
		expect(discordMock.getResponse("pung")).to.equal("reactionMessage");
		expect(discordMock.getEmoji("pung")).to.equal("😳");
		// TODO: mock reactions?
	});
});

describe("Messages", function () {
	it("sendMessage", async function () {
		const msg = await discord.sendMessage("sentChannel", "test message", {
			filename: "file.txt",
			contents: "file contents"
		});
		expect(msg.content).to.equal("test message");
		expect(discordMock.getResponse("sentChannel")).to.equal("test message");
		expect(discordMock.getFile("sentChannel")).to.deep.equal({
			filename: "file.txt",
			contents: "file contents"
		});
	});

	it("deleteMessage", async function () {
		await expect(discord.deleteMessage("delChannel", "delMessage")).to.not.be.rejected;
	});

	it("sendDirectMessage", async function () {
		await discord.sendDirectMessage("sentUser", "test message");
		expect(discordMock.getResponse("sentUser")).to.equal("test message");
	});
});
