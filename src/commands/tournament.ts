import { Message } from "eris";
import { Tournament } from "../tournament";
import { getTournamentInterface, getMentionedUserId } from "./utils";
import { getOngoingTournaments, getPlayerFromDiscord } from "../actions";
import { TypedDeck } from "ydke";
import { DiscordDeck } from "../discordDeck";
import { bot, getTORoleFromMessage } from "../bot";
import { UserError } from "../errors";

export async function createTournament(msg: Message, args: string[]): Promise<void> {
	const role = await getTORoleFromMessage(msg);
	if (!(msg.member && msg.member.roles.includes(role))) {
		throw new UserError("You must have the MC-TO role to create a tournament in this server!");
	}
	const [name, desc] = args;
	if (name.length === 0 || desc.length === 0) {
		throw new UserError("You must provide a valid tournament name and description!");
	}
	const tournament = await Tournament.init(name, desc, msg);
	const [, doc] = await getTournamentInterface(tournament.id, msg.author.id);
	await msg.channel.createMessage(
		`Tournament ${name} created! You can find it at https://challonge.com/${doc.challongeId}. For future commands, refer to this tournament by the id \`${doc.challongeId}\``
	);
}

export async function updateTournament(msg: Message, args: string[]): Promise<void> {
	const [id, name, desc] = args;
	const [tournament, doc] = await getTournamentInterface(id, msg.author.id);
	const oldName = doc.name;
	const oldDesc = doc.description;
	if (name.length === 0 || desc.length === 0) {
		throw new UserError("You must provide a valid tournament name and description!");
	}
	const [newName, newDesc] = await tournament.updateTournament(name, desc, msg.author.id);
	await msg.channel.createMessage(
		`Tournament ${oldName} successfully renamed to ${newName}!\nPrevious description:\n${oldDesc}\nNew description:\n${newDesc}`
	);
}

export async function listTournaments(msg: Message): Promise<void> {
	const tournaments = await getOngoingTournaments();
	await msg.channel.createMessage(
		tournaments
			.map(
				t =>
					`ID: \`${t.challongeId}\`|Name: \`${t.name}\`|Status: \`${t.status}\`|Players: ${t.confirmedParticipants.length}`
			)
			.join("\n")
	);
}

export async function listPlayers(msg: Message, args: string[]): Promise<void> {
	const [id] = args;
	const [, doc] = await getTournamentInterface(id, msg.author.id);
	if (doc.confirmedParticipants.length === 0) {
		await msg.channel.createMessage("That tournament has no confirmed participants yet!");
		return;
	}
	await msg.channel.createMessage(doc.confirmedParticipants.map(p => `<@${p.discord}>`).join(", "));
}

export async function getPlayerDeck(msg: Message, args: string[]): Promise<void> {
	const [id] = args;
	const [, doc] = await getTournamentInterface(id, msg.author.id);
	const user = getMentionedUserId(msg);
	const player = await getPlayerFromDiscord(doc.challongeId, user);
	if (!player) {
		throw new UserError(`Could not find a player in tournament ${doc.name} for Discord user <@${user}>`);
	}
	const record: TypedDeck = {
		main: Uint32Array.from(player.deck.main),
		extra: Uint32Array.from(player.deck.extra),
		side: Uint32Array.from(player.deck.side)
	};
	const deck = DiscordDeck.constructFromRecord(record);
	const discordUser = bot.users.get(user);
	await deck.sendProfile(
		msg.channel.id,
		discordUser ? `${discordUser.username}#${discordUser.discriminator}ydk` : user
	);
}
