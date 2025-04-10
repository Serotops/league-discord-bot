import { CommandInteraction } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { YouTubeService } from '../services/youtube';
import { LEAGUES } from '../config/constants';

export class RefreshCommand {
    private prisma: PrismaClient;
    private youtubeService: YouTubeService;

    constructor(prisma: PrismaClient, youtubeService: YouTubeService) {
        this.prisma = prisma;
        this.youtubeService = youtubeService;
    }

    async execute(interaction: CommandInteraction): Promise<{ message: string }> {
        const user = await this.prisma.user.findUnique({
            where: { discordId: interaction.user.id },
        });

        if (!user) {
            return {
                message: 'Tu n\'as pas encore lié ta chaîne YouTube. Utilise la commande `/link` d\'abord.',
            };
        }

        try {
            const { access_token, refresh_token } = await this.youtubeService.refreshToken(
                user.accessToken,
                user.refreshToken
            );

            const channelData = await this.youtubeService.getChannelData(access_token, refresh_token);
            const league = LEAGUES.find((l) => channelData.subs >= l.minSubs && channelData.subs < l.maxSubs);

            if (!league) {
                throw new Error('No league found for subscriber count');
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
                message: `Ton nombre d'abonnés a été mis à jour : ${channelData.subs.toLocaleString()} abonnés (${league.name})`,
            };
        } catch (error) {
            console.error('Error refreshing token:', error);
            return {
                message: 'Une erreur est survenue lors de la mise à jour de tes données. Veuillez réessayer.',
            };
        }
    }
} 