import { Deck } from "ydeck";
import { DatabasePlayer } from "../../src/database/interface";
import { getDeck } from "../../src/deck/deck";
import { TournamentInterface } from "../../src/TournamentManager";

export class TournamentMock implements TournamentInterface {
	public async authenticateHost(): Promise<void> {
		return;
	}

	public async authenticatePlayer(): Promise<void> {
		return;
	}

	public async listTournaments(): Promise<string> {
		return "This sure is a list.";
	}

	public async createTournament(hostId: string, serverId: string, name: string): Promise<[string, string, string]> {
		// the point of this file is to return a simulated input for testing other files
		// actual functionality here will be tested with other files
		return [`${name}`, `https://example.com/${name}`, `Guide: mc!help ${name}`];
	}

	public async registerPlayer(): Promise<void> {
		return;
	}

	public async updateTournament(): Promise<void> {
		return;
	}

	public async addAnnouncementChannel(): Promise<void> {
		return;
	}

	public async removeAnnouncementChannel(): Promise<void> {
		return;
	}

	public async addHost(): Promise<void> {
		return;
	}

	public async removeHost(): Promise<void> {
		return;
	}

	public async confirmPlayer(): Promise<void> {
		return;
	}

	public async cleanRegistration(): Promise<void> {
		return;
	}

	public async openTournament(): Promise<void> {
		return;
	}

	public async startTournament(): Promise<void> {
		return;
	}

	public async finishTournament(): Promise<void> {
		return;
	}

	public async cancelTournament(): Promise<void> {
		return;
	}

	public async submitScore(): Promise<string> {
		return "For more detail, test the tournament handler!";
	}

	public async submitScoreForce(): Promise<string> {
		return "For more detail, test the tournament handler!";
	}

	public async nextRound(): Promise<void> {
		return;
	}

	public async getConfirmed(): Promise<DatabasePlayer[]> {
		return [];
	}

	public async getPlayerDeck(): Promise<Deck> {
		// ABC test deck from YDeck test suites
		return await getDeck(
			"ydke://5m3qBeZt6gV9+McCffjHAn34xwK8beUDvG3lA7xt5QMfX5ICWvTJAVr0yQFa9MkBrDOdBKwznQSsM50Ey/UzAMv1MwDL9TMAdAxQBQ6wYAKvI94AryPeAK8j3gCmm/QBWXtjBOMavwDjGr8A4xq/AD6kcQGeE8oEnhPKBJ4TygSlLfUDpS31A6Ut9QMiSJkAIkiZACJImQCANVMDgDVTAw==!FtIXALVcnwC1XJ8AiBF2A4gRdgNLTV4Elt0IAMf4TQHCT0EAvw5JAqSaKwD5UX8EweoDA2LO9ATaI+sD!H1+SAg==!"
		);
	}

	public async dropPlayer(): Promise<void> {
		return;
	}

	public async syncTournament(): Promise<void> {
		return;
	}

	public async registerBye(): Promise<string[]> {
		return ["bye1"];
	}

	public async removeBye(): Promise<string[]> {
		return ["bye1"];
	}

	public async prunePlayers(): Promise<string[]> {
		return [];
	}
}
