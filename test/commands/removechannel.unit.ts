import chai, { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import { Client, Message } from "eris";
import sinon, { SinonSandbox } from "sinon";
import sinonChai from "sinon-chai";
import sinonTest from "sinon-test";
import { CommandSupport } from "../../src/Command";
import command from "../../src/commands/removechannel";
import { DiscordInterface } from "../../src/discord/interface";
import { OrganiserRoleProvider } from "../../src/role/organiser";
import { DiscordWrapperMock } from "../mocks/discord";
import { TournamentMock } from "../mocks/tournament";

chai.use(chaiAsPromised);
chai.use(sinonChai);
const test = sinonTest(sinon);

describe("command:removechannel", function () {
	const support: CommandSupport = {
		discord: new DiscordInterface(new DiscordWrapperMock()),
		tournamentManager: new TournamentMock(),
		organiserRole: new OrganiserRoleProvider("MC-TO")
	};
	const msg = new Message({ id: "007", channel_id: "foo", author: { id: "0000" } }, new Client("mock"));
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
	it("removes a public channel by default", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			"This channel removed as a public announcement channel for Tournament name!"
		);
	});
	it("removes public channels", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name", "public"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			"This channel removed as a public announcement channel for Tournament name!"
		);
	});
	it("removes private channels", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name", "private"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			"This channel removed as a private announcement channel for Tournament name!"
		);
	});
});
