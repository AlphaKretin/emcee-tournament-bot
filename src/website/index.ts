export interface WebsiteWrapper {
	createTournament(name: string, desc: string): Promise<WebsiteTournament>;
	updateTournament(tournamentId: string, name: string, desc: string): Promise<void>;
}

// interface structure WIP as fleshed out command-by-command
export interface WebsiteTournament {
	id: string;
	name: string;
	desc: string;
	url: string;
}

export class WebsiteInterface {
	private api: WebsiteWrapper;
	constructor(api: WebsiteWrapper) {
		this.api = api;
	}

	public async createTournament(name: string, desc: string): Promise<WebsiteTournament> {
		return await this.api.createTournament(name, desc);
	}

	public async updateTournament(tournamentId: string, name: string, desc: string): Promise<void> {
		return await this.api.updateTournament(tournamentId, name, desc);
	}
}