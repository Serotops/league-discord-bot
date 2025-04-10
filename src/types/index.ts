export interface League {
	name: string;
	minSubs: number;
	channelId: string | undefined;
}

export interface UserData {
	discordId: string;
	youtubeId: string;
	youtubeName: string;
	subscriberCount: number;
	league: string;
	accessToken: string;
	refreshToken: string;
}

export interface RefreshResult {
	success: boolean;
	message: string;
	leagueChanged?: boolean;
}
