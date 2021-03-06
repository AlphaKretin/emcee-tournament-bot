import { expect } from "chai";
import sinon from "sinon";
import command from "../../src/commands/removechannel";
import { itRejectsNonHosts, msg, support } from "./common";

describe("command:removechannel", function () {
	itRejectsNonHosts(support, command, msg, ["name"]);
	it("removes a public channel by default", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			sinon.match({ content: "This channel removed as a public announcement channel for Tournament name!" })
		);
	});
	it("removes public channels", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name", "public"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			sinon.match({ content: "This channel removed as a public announcement channel for Tournament name!" })
		);
	});
	it("removes private channels", async () => {
		msg.channel.createMessage = sinon.spy();
		await command.executor(msg, ["name", "private"], support);
		expect(msg.channel.createMessage).to.have.been.calledOnceWithExactly(
			sinon.match({ content: "This channel removed as a private announcement channel for Tournament name!" })
		);
	});
});
