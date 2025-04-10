import express, { Request, Response, Application } from 'express';
import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
} from 'discord.js';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';
import { LEAGUES } from './config/constants';

dotenv.config();

const app: Application = express();
const prisma = new PrismaClient();

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

// Discord bot events
discordClient.once('ready', () => {
    console.log(`🤖 Bot connecté en tant que ${discordClient.user?.tag}`);
});

discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
        switch (interaction.commandName) {
            case 'link':
                const authUrl = oauth2Client.generateAuthUrl({
                    access_type: 'offline',
                    prompt: 'consent',
                    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
                    state: interaction.user.id,
                });

                await interaction.reply(
                    `Clique ici pour connecter ta chaîne YouTube : ${authUrl}`
                );
                break;

            case 'refresh':
                const user = await prisma.user.findUnique({
                    where: { discordId: interaction.user.id },
                });

                if (!user) {
                    await interaction.reply(
                        'Tu n\'as pas encore lié ta chaîne YouTube. Utilise la commande `/link` d\'abord.'
                    );
                    return;
                }

                try {
                    oauth2Client.setCredentials({
                        access_token: user.accessToken,
                        refresh_token: user.refreshToken,
                    });

                    const { tokens } = await oauth2Client.refreshAccessToken();
                    oauth2Client.setCredentials(tokens);

                    const youtube = google.youtube('v3');
                    const response = await youtube.channels.list({
                        auth: oauth2Client,
                        part: ['snippet', 'statistics'],
                        mine: true,
                    });

                    const channel = response.data.items?.[0];
                    if (!channel) {
                        throw new Error('Channel not found');
                    }

                    const subs = parseInt(channel.statistics?.subscriberCount || '0');
                    const league = LEAGUES.find(
                        (l) => subs >= l.minSubs && subs < l.maxSubs
                    );

                    if (!league) {
                        throw new Error('No league found for subscriber count');
                    }

                    await prisma.user.update({
                        where: { discordId: interaction.user.id },
                        data: {
                            subscriberCount: subs,
                            league: league.name,
                            accessToken: tokens.access_token,
                            refreshToken: tokens.refresh_token,
                        },
                    });

                    await interaction.reply(
                        `Ton nombre d'abonnés a été mis à jour : ${subs.toLocaleString()} abonnés (${league.name})`
                    );
                } catch (error) {
                    console.error('Error refreshing token:', error);
                    await interaction.reply(
                        'Une erreur est survenue lors de la mise à jour de tes données. Veuillez réessayer.'
                    );
                }
                break;

            case 'leaderboard':
                const leagueOption = interaction.options.getString('league') || 'Bronze';
                const leagueData = LEAGUES.find(
                    (l) => l.name.toLowerCase() === leagueOption.toLowerCase()
                );

                if (!leagueData) {
                    await interaction.reply('Cette ligue n\'existe pas !');
                    return;
                }

                const users = await prisma.user.findMany({
                    where: { league: leagueData.name },
                    orderBy: { subscriberCount: 'desc' },
                    take: 10,
                });

                let message = `🏆 Top 10 de la ligue ${leagueData.name} 🏆\n\n`;
                users.forEach((user, index) => {
                    message += `${index + 1}. ${user.youtubeName} - ${user.subscriberCount.toLocaleString()} abonnés\n`;
                });

                await interaction.reply(message);
                break;
        }
    } catch (error) {
        console.error('Error handling command:', error);
        if (!interaction.replied) {
            await interaction.reply('Une erreur est survenue lors de l\'exécution de la commande.');
        }
    }
});

// Express routes
app.get('/auth/callback', async (req: Request, res: Response): Promise<void> => {
    const { code, state } = req.query;
    if (!code || !state || Array.isArray(state)) {
        res.sendStatus(400);
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code as string);
        
        if (!tokens.access_token || !tokens.refresh_token) {
            res.send('Erreur: Impossible d\'obtenir les tokens nécessaires. Veuillez réessayer.');
            return;
        }

        oauth2Client.setCredentials(tokens);

        const youtube = google.youtube('v3');
        const response = await youtube.channels.list({
            auth: oauth2Client,
            part: ['snippet', 'statistics'],
            mine: true,
        });

        const channel = response.data.items?.[0];
        if (!channel) {
            throw new Error('Channel not found');
        }

        const subs = parseInt(channel.statistics?.subscriberCount || '0');
        const league = LEAGUES.find(
            (l) => subs >= l.minSubs && subs < l.maxSubs
        );

        if (!league) {
            throw new Error('No league found for subscriber count');
        }

        await prisma.user.upsert({
            where: { discordId: state as string },
            update: {
                youtubeId: channel.id,
                youtubeName: channel.snippet?.title || 'Unknown',
                subscriberCount: subs,
                league: league.name,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
            },
            create: {
                discordId: state as string,
                youtubeId: channel.id,
                youtubeName: channel.snippet?.title || 'Unknown',
                subscriberCount: subs,
                league: league.name,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
            },
        });

        res.send('Chaîne liée avec succès ! Tu peux retourner sur Discord.');
    } catch (error) {
        console.error('Error in auth callback:', error);
        res.send('Une erreur est survenue lors de la liaison de votre chaîne. Veuillez réessayer.');
    }
});

// Register slash commands
(async () => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    const commands = [
        new SlashCommandBuilder()
            .setName('link')
            .setDescription('Lier sa chaîne YouTube'),
        new SlashCommandBuilder()
            .setName('refresh')
            .setDescription('Actualiser ton nombre d\'abonnés'),
        new SlashCommandBuilder()
            .setName('leaderboard')
            .setDescription('Voir le classement d\'une ligue')
            .addStringOption(option =>
                option.setName('league')
                    .setDescription('La ligue à afficher')
                    .addChoices(
                        { name: 'Bronze', value: 'Bronze' },
                        { name: 'Silver', value: 'Silver' },
                        { name: 'Gold', value: 'Gold' },
                        { name: 'Platinum', value: 'Platinum' }
                    )
            ),
    ].map(cmd => cmd.toJSON());

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
        body: commands,
    });
})();

// Start the server
app.listen(3000, () =>
    console.log('🌐 Serveur Express lancé sur http://localhost:3000')
);

// Start the bot
discordClient.login(process.env.DISCORD_TOKEN); 