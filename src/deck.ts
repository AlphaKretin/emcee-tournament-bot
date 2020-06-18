import { Message } from "eris";
import fetch from "node-fetch";
import { TypedDeck, parseURL, toURL } from "ydke";
import { data } from "./data";
import { enums } from "ygopro-data";

interface DeckProfile {
	nameCounts: {
		main: ProfileCounts;
		extra: ProfileCounts;
		side: ProfileCounts;
	};
	typeCounts: {
		main: ProfileCounts;
		extra: ProfileCounts;
		side: ProfileCounts;
	};
	archetypes: string[];
	ydk: string;
	url: string;
}

type ProfileCounts = { [name: string]: number };

export class Deck {
	readonly url: string;
	readonly ydk: string;
	private record: TypedDeck;
	constructor(record: TypedDeck, url: string, ydk: string) {
		this.record = record;
		this.url = url;
		this.ydk = ydk;
	}

	private static async messageToYdk(msg: Message): Promise<string> {
		const attach = msg.attachments[0];
		const file = await fetch(attach.url);
		const deck = await file.text();
		return deck;
	}

	private static async constructFromFile(msg: Message): Promise<Deck> {
		const ydk = await Deck.messageToYdk(msg);
		const record = Deck.ydkToRecord(ydk);
		const url = Deck.recordToUrl(record);
		return new Deck(record, url, ydk);
	}

	private static constructFromUrl(url: string): Deck {
		const record = Deck.urlToRecord(url);
		const ydk = Deck.recordToYdk(record);
		return new Deck(record, url, ydk);
	}

	static async construct(msg: Message): Promise<Deck> {
		if (msg.attachments.length > 0 && msg.attachments[0].filename.endsWith(".ydk")) {
			return await this.constructFromFile(msg);
		}
		const ydkeReg = /ydke:\/\/[A-Za-z0-9+/=]*?![A-Za-z0-9+/=]*?![A-Za-z0-9+/=]*?!/g;
		const match = ydkeReg.exec(msg.content);
		if (match == null) {
			throw new Error("Must provide either attached `.ydk` file or valid `ydke://` URL!");
		}
		const ydke = match[0];
		return this.constructFromUrl(ydke);
	}

	private static urlToRecord(url: string): TypedDeck {
		return parseURL(url);
	}

	private static ydkToRecord(ydk: string): TypedDeck {
		const main = [];
		const extra = [];
		const side = [];
		let currentSection = "";
		for (const line of ydk.split(/\r|\n|\r\n/)) {
			if (line.startsWith("#") || line.startsWith("!")) {
				currentSection = line.slice(1);
				continue;
			}
			if (line.trim().length > 0) {
				const code = parseInt(line, 10);
				if (currentSection === "side") {
					side.push(code);
				} else if (currentSection === "extra") {
					extra.push(code);
				} else if (currentSection === "main") {
					main.push(code);
				}
			}
		}
		const typedMain = Uint32Array.from(main);
		const typedExtra = Uint32Array.from(extra);
		const typedSide = Uint32Array.from(side);
		return {
			main: typedMain,
			extra: typedExtra,
			side: typedSide
		};
	}

	private static recordToUrl(record: TypedDeck): string {
		return toURL(record);
	}

	private static recordToYdk(record: TypedDeck): string {
		let ydk = "#created by Akira bot\n#main\n";
		for (const code of record.main) {
			ydk += code + "\n";
		}
		ydk += "#extra\n";
		for (const code of record.extra) {
			ydk += code + "\n";
		}
		ydk += "!side\n";
		for (const code of record.side) {
			ydk += code + "\n";
		}
		return ydk;
	}

	private static increment(obj: ProfileCounts, key: string): void {
		if (key in obj) {
			obj[key]++;
		} else {
			obj[key] = 1;
		}
	}

	public async getProfile(): Promise<DeckProfile> {
		const mainTypeCounts: ProfileCounts = {
			monster: 0,
			spell: 0,
			trap: 0
		};
		const extraTypeCounts: ProfileCounts = {
			fusion: 0,
			synchro: 0,
			xyz: 0,
			link: 0
		};
		const sideTypeCounts: ProfileCounts = {
			monster: 0,
			spell: 0,
			trap: 0
		};

		const mainNameCounts: ProfileCounts = {};
		const extraNameCounts: ProfileCounts = {};
		const sideNameCounts: ProfileCounts = {};

		const archetypeCounts: ProfileCounts = {};

		for (const code of this.record.main) {
			const card = await data.getCard(code, "en");
			if (!card) {
				Deck.increment(mainNameCounts, code.toString());
				continue;
			}
			if ("en" in card.text) {
				Deck.increment(mainNameCounts, card.text.en.name);
				const sets = await card.data.names.en.setcode;
				for (const set of sets) {
					Deck.increment(archetypeCounts, set);
				}
			} else {
				Deck.increment(mainNameCounts, code.toString());
			}

			if (card.data.isType(enums.type.TYPE_MONSTER)) {
				Deck.increment(mainTypeCounts, "monster");
			} else if (card.data.isType(enums.type.TYPE_SPELL)) {
				Deck.increment(mainTypeCounts, "spell");
			} else if (card.data.isType(enums.type.TYPE_TRAP)) {
				Deck.increment(mainTypeCounts, "trap");
			}
		}

		for (const code of this.record.extra) {
			const card = await data.getCard(code, "en");
			if (!card) {
				Deck.increment(extraNameCounts, code.toString());
				continue;
			}
			if ("en" in card.text) {
				Deck.increment(extraNameCounts, card.text.en.name);
				const sets = await card.data.names.en.setcode;
				for (const set of sets) {
					Deck.increment(archetypeCounts, set);
				}
			} else {
				Deck.increment(extraNameCounts, code.toString());
			}

			if (card.data.isType(enums.type.TYPE_FUSION)) {
				Deck.increment(extraTypeCounts, "fusion");
			} else if (card.data.isType(enums.type.TYPE_SYNCHRO)) {
				Deck.increment(extraTypeCounts, "synchro");
			} else if (card.data.isType(enums.type.TYPE_XYZ)) {
				Deck.increment(extraTypeCounts, "xyz");
			} else if (card.data.isType(enums.type.TYPE_LINK)) {
				Deck.increment(extraTypeCounts, "link");
			}
		}

		for (const code of this.record.side) {
			const card = await data.getCard(code, "en");
			if (!card) {
				Deck.increment(sideNameCounts, code.toString());
				continue;
			}
			if ("en" in card.text) {
				Deck.increment(sideNameCounts, card.text.en.name);
			} else {
				Deck.increment(sideNameCounts, code.toString());
			}

			if (card.data.isType(enums.type.TYPE_MONSTER)) {
				Deck.increment(sideTypeCounts, "monster");
			} else if (card.data.isType(enums.type.TYPE_SPELL)) {
				Deck.increment(sideTypeCounts, "spell");
			} else if (card.data.isType(enums.type.TYPE_TRAP)) {
				Deck.increment(sideTypeCounts, "trap");
			}
		}

		const archetypes = [];
		for (const set in archetypeCounts) {
			if (archetypeCounts[set] > 9) {
				archetypes.push(set);
			}
		}

		return {
			nameCounts: {
				main: mainNameCounts,
				extra: extraNameCounts,
				side: sideNameCounts
			},
			typeCounts: {
				main: mainTypeCounts,
				extra: extraTypeCounts,
				side: sideTypeCounts
			},
			archetypes,
			ydk: this.ydk,
			url: this.url
		};
	}
}
