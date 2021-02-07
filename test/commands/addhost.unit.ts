import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Client, Message, User } from "eris";
import sinon, { SinonSandbox } from "sinon";
import sinonChai from "sinon-chai";
import sinonTest from "sinon-test";
import { CommandSupport } from "../../src/Command";
import command from "../../src/commands/addhost";
import { DiscordInterface } from "../../src/discord/interface";
import { OrganiserRoleProvider } from "../../src/role/organiser";
import { DiscordWrapperMock } from "../mocks/discord";
import { TournamentMock } from "../mocks/tournament";

chai.use(chaiAsPromised);
chai.use(sinonChai);
const test = sinonTest(sinon);
const mockBotClient = new Client("mock");

describe("command:addhost", function () {
	const support: CommandSupport = {
		discord: new DiscordInterface(new DiscordWrapperMock()),
		tournamentManager: new TournamentMock(),
		organiserRole: new OrganiserRoleProvider("MC-TO")
	};
	const msg = new Message({ id: "007", channel_id: "foo", author: { id: "0000" } }, mockBotClient);
	it(
		"rejects non-hosts",
		test(function (this: SinonSandbox) {
			const authStub = this.stub(support.tournamentManager, "authenticateHost").rejects();
			msg.channel.createMessage = sinon.spy();
			expect(command.executor(msg, ["name"], support)).to.be.rejected;
			expect(authStub).to.have.been.called;
			expect(msg.channel.createMessage).to.not.have.been.called;
		})
	);
	it("requires a mentioned user", async () => {
		msg.mentions = [];
		msg.channel.createMessage = sinon.spy();
		expect(command.executor(msg, ["name"], support)).to.be.rejectedWith("Message does not mention a user!");
		expect(msg.channel.createMessage).to.not.have.been.called;
	});
	it("adds the mentioned user", async () => {
		msg.mentions = [new User({ id: "nova" }, mockBotClient)];
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			"<@nova> added as a host for Tournament name!"
		);
	});
});
