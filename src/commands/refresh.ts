import { ChatInputCommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { YouTubeService } from '../services/youtube';
import { LEAGUES } from '../config/constants';

type League = (typeof LEAGUES)[number];

export class RefreshCommand {
	private prisma: PrismaClient;
	private youtubeService: YouTubeService;

	constructor(prisma: PrismaClient, youtubeService: YouTubeService) {
		this.prisma = prisma;
		this.youtubeService = youtubeService;
	}

	async execute(
		interaction: ChatInputCommandInteraction
	): Promise<{ message: string }> {
		const user = await this.prisma.user.findUnique({
			where: { discordId: interaction.user.id },
		});

		if (!user) {
			return {
				message:
					"Tu n'as pas encore lié ta chaîne YouTube. Utilise la commande `/link` d'abord.",
			};
		}

		try {
			const { access_token, refresh_token } =
				await this.youtubeService.refreshToken(
					user.accessToken,
					user.refreshToken
				);

			const channelData = await this.youtubeService.getChannelData(
				access_token,
				refresh_token
			);

			// Find the appropriate league based on subscriber count
			// Start from highest league and go down until we find a match
			let league: League = LEAGUES[0]; // Default to Bronze
			for (let i = LEAGUES.length - 1; i >= 0; i--) {
				if (channelData.subs >= LEAGUES[i].minSubs) {
					league = LEAGUES[i];
					break;
				}
			}

			await this.prisma.user.update({
				where: { discordId: interaction.user.id },
				data: {
					subscriberCount: channelData.subs,
					league: league.name,
					accessToken: access_token,
					refreshToken: refresh_token,
				},
			});

			return {
				message: `Ton nombre d'abonnés a été mis à jour : ${channelData.subs.toLocaleString()} abonnés (${
					league.name
				})`,
			};
		} catch (error) {
			console.error('Error refreshing token:', error);
			return {
				message:
					'Une erreur est survenue lors de la mise à jour de tes données. Veuillez réessayer.',
			};
		}
	}
}
