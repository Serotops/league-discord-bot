import { LEAGUES } from '../config/constants';
import { League } from '../types';
import { PrismaClient } from '@prisma/client';
import { Client, TextChannel } from 'discord.js';

export class LeagueService {
    private prisma: PrismaClient;
    private discordClient: Client;

    constructor(prisma: PrismaClient, discordClient: Client) {
        this.prisma = prisma;
        this.discordClient = discordClient;
    }

    getLeagueBySubs(subscriberCount: number): League {
        return LEAGUES.filter((l) => subscriberCount >= l.minSubs).pop() || LEAGUES[0];
    }

    async updateLeaderboardChannel(channelId: string, leagueName: string): Promise<void> {
        const channel = await this.discordClient.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) return;

        const users = await this.prisma.user.findMany({
            where: { league: leagueName },
            orderBy: { subscriberCount: 'desc' },
        });

        let message = `🏆 Classement ${leagueName} 🏆\n\n`;
        users.forEach((user, index) => {
            message += `${index + 1}. ${user.youtubeName} - ${user.subscriberCount.toLocaleString()} abonnés\n`;
        });

        // Delete previous messages
        const messages = await channel.messages.fetch({ limit: 10 });
        await Promise.all(messages.map(msg => msg.delete()));

        // Send new leaderboard
        await channel.send(message);
    }

    async getLeaderboard(leagueName: string, limit: number = 10) {
        return this.prisma.user.findMany({
            where: { league: leagueName },
            orderBy: { subscriberCount: 'desc' },
            take: limit,
        });
    }
} 