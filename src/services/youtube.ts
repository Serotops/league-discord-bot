import { OAuth2Client } from 'googleapis-common';
import { google } from 'googleapis';

export interface ChannelData {
	id: string;
	name: string;
	subs: number;
}

export class YouTubeService {
	private oauth2Client: OAuth2Client;

	constructor(oauth2Client: OAuth2Client) {
		this.oauth2Client = oauth2Client;
	}

	async getChannelData(
		accessToken: string,
		refreshToken: string
	): Promise<ChannelData> {
		this.oauth2Client.setCredentials({
			access_token: accessToken,
			refresh_token: refreshToken,
		});

		const youtube = google.youtube('v3');
		const response = await youtube.channels.list({
			auth: this.oauth2Client,
			part: ['snippet', 'statistics'],
			mine: true,
		});

		const channel = response.data.items?.[0];
		if (!channel) {
			throw new Error('Channel not found');
		}

		return {
			id: channel.id!,
			name: channel.snippet?.title || 'Unknown',
			subs: parseInt(channel.statistics?.subscriberCount || '0'),
		};
	}

	async refreshToken(
		accessToken: string,
		refreshToken: string
	): Promise<{ access_token: string; refresh_token: string }> {
		this.oauth2Client.setCredentials({
			access_token: accessToken,
			refresh_token: refreshToken,
		});

		const response = await this.oauth2Client.refreshAccessToken();
		this.oauth2Client.setCredentials(response.credentials);

		if (
			!response.credentials.access_token ||
			!response.credentials.refresh_token
		) {
			throw new Error('Failed to refresh tokens');
		}

		return {
			access_token: response.credentials.access_token,
			refresh_token: response.credentials.refresh_token,
		};
	}
}
