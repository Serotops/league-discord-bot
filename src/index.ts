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
import { YouTubeService } from './services/youtube';

type League = (typeof LEAGUES)[number];

dotenv.config();

const app: Application = express();
const prisma = new PrismaClient();

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

const oauth2Client = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI
);

const youtubeService = new YouTubeService(oauth2Client);

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
						"Tu n'as pas encore lié ta chaîne YouTube. Utilise la commande `/link` d'abord."
					);
					return;
				}

				try {
					const { access_token, refresh_token } =
						await youtubeService.refreshToken(
							user.accessToken,
							user.refreshToken
						);

					const channelData = await youtubeService.getChannelData(
						access_token,
						refresh_token
					);

					// Find the appropriate league based on subscriber count
					let league: League = LEAGUES[0]; // Default to Bronze
					for (let i = LEAGUES.length - 1; i >= 0; i--) {
						if (channelData.subs >= LEAGUES[i].minSubs) {
							league = LEAGUES[i];
							break;
						}
					}

					await prisma.user.update({
						where: { discordId: interaction.user.id },
						data: {
							subscriberCount: channelData.subs,
							league: league.name,
							accessToken: access_token,
							refreshToken: refresh_token,
						},
					});

					await interaction.reply(
						`Ton nombre d'abonnés a été mis à jour : ${channelData.subs.toLocaleString()} abonnés (${
							league.name
						})`
					);
				} catch (error) {
					console.error('Error refreshing token:', error);
					await interaction.reply(
						'Une erreur est survenue lors de la mise à jour de tes données. Veuillez réessayer.'
					);
				}
				break;

			case 'leaderboard':
				const leagueOption =
					interaction.options.getString('league') || 'Bronze';
				const leagueData = LEAGUES.find(
					(l) => l.name.toLowerCase() === leagueOption.toLowerCase()
				);

				if (!leagueData) {
					await interaction.reply("Cette ligue n'existe pas !");
					return;
				}

				const users = await prisma.user.findMany({
					where: { league: leagueData.name },
					orderBy: { subscriberCount: 'desc' },
					take: 10,
				});

				let message = `🏆 Top 10 de la ligue ${leagueData.name} 🏆\n\n`;
				users.forEach((user, index) => {
					message += `${index + 1}. ${
						user.youtubeName
					} - ${user.subscriberCount.toLocaleString()} abonnés\n`;
				});

				await interaction.reply(message);
				break;
		}
	} catch (error) {
		console.error('Error handling command:', error);
		if (!interaction.replied) {
			await interaction.reply(
				"Une erreur est survenue lors de l'exécution de la commande."
			);
		}
	}
});

// Express routes
app.get('/', (req: Request, res: Response) => {
	res.status(200).json({ status: 'ok', message: 'Server is running' });
});

app.get('/health', (req: Request, res: Response) => {
	res.status(200).json({ 
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: process.uptime()
	});
});

app.get(
	'/auth/callback',
	async (req: Request, res: Response): Promise<void> => {
		const { code, state } = req.query;
		if (!code || !state || Array.isArray(state)) {
			res.sendStatus(400);
			return;
		}

		try {
			const { tokens } = await oauth2Client.getToken(code as string);

			if (!tokens.access_token || !tokens.refresh_token) {
				res.send(
					"Erreur: Impossible d'obtenir les tokens nécessaires. Veuillez réessayer."
				);
				return;
			}

			oauth2Client.setCredentials(tokens);

			const channelData = await youtubeService.getChannelData(
				tokens.access_token,
				tokens.refresh_token
			);

			// Find the appropriate league based on subscriber count
			let league: League = LEAGUES[0]; // Default to Bronze
			for (let i = LEAGUES.length - 1; i >= 0; i--) {
				if (channelData.subs >= LEAGUES[i].minSubs) {
					league = LEAGUES[i];
					break;
				}
			}

			await prisma.user.upsert({
				where: { discordId: state as string },
				update: {
					youtubeId: channelData.id,
					youtubeName: channelData.name,
					subscriberCount: channelData.subs,
					league: league.name,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
				},
				create: {
					discordId: state as string,
					youtubeId: channelData.id,
					youtubeName: channelData.name,
					subscriberCount: channelData.subs,
					league: league.name,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
				},
			});

			res.send(
				'Chaîne liée avec succès ! Tu peux retourner sur Discord.'
			);
		} catch (error) {
			console.error('Error in auth callback:', error);
			res.send(
				'Une erreur est survenue lors de la liaison de votre chaîne. Veuillez réessayer.'
			);
		}
	}
);

// Register slash commands
(async () => {
	const rest = new REST({ version: '10' }).setToken(
		process.env.DISCORD_TOKEN!
	);

	const commands = [
		new SlashCommandBuilder()
			.setName('link')
			.setDescription('Lier sa chaîne YouTube'),
		new SlashCommandBuilder()
			.setName('refresh')
			.setDescription("Actualiser ton nombre d'abonnés"),
		new SlashCommandBuilder()
			.setName('leaderboard')
			.setDescription("Voir le classement d'une ligue")
			.addStringOption((option) =>
				option
					.setName('league')
					.setDescription('La ligue à afficher')
					.addChoices(
						{ name: 'Bronze', value: 'Bronze' },
						{ name: 'Silver', value: 'Silver' },
						{ name: 'Gold', value: 'Gold' },
						{ name: 'Platinum', value: 'Platinum' }
					)
			),
	].map((cmd) => cmd.toJSON());

	await rest.put(Routes.applicationCommands(process.env.CLIENT_ID!), {
		body: commands,
	});
})();

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
	console.log(`🌐 Serveur Express lancé sur http://localhost:${PORT}`);
	console.log('Bot is ready!');
});

// Handle server errors
server.on('error', (error) => {
	console.error('Server error:', error);
	process.exit(1);
});

// Start the bot
discordClient.login(process.env.DISCORD_TOKEN);
