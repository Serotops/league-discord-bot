import express, { Request, Response, Application } from 'express';
import {
	Client,
	GatewayIntentBits,
	REST,
	Routes,
	SlashCommandBuilder,
	TextChannel,
} from 'discord.js';
import dotenv from 'dotenv';
import { google } from 'googleapis';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const app: Application = express();
const prisma = new PrismaClient();

const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

const oauth2Client = new google.auth.OAuth2(
	process.env.GOOGLE_CLIENT_ID,
	process.env.GOOGLE_CLIENT_SECRET,
	process.env.GOOGLE_REDIRECT_URI
);

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

const leagues = [
	{ name: 'Bronze', minSubs: 0, channelId: process.env.BRONZE_CHANNEL_ID },
	{ name: 'Silver', minSubs: 1000, channelId: process.env.SILVER_CHANNEL_ID },
	{ name: 'Gold', minSubs: 10000, channelId: process.env.GOLD_CHANNEL_ID },
	{
		name: 'Platinum',
		minSubs: 100000,
		channelId: process.env.PLATINUM_CHANNEL_ID,
	},
];

// ============ DISCORD BOT ============
discordClient.once('ready', () => {
	console.log(`🤖 Bot connecté en tant que ${discordClient.user?.tag}`);
});

// Commande /link
discordClient.on('interactionCreate', async (interaction) => {
	if (!interaction.isChatInputCommand()) return;
	if (interaction.commandName === 'link') {
		const authUrl = oauth2Client.generateAuthUrl({
			access_type: 'offline',
			prompt: 'consent',
			scope: ['https://www.googleapis.com/auth/youtube.readonly'],
			state: interaction.user.id,
		});
		await interaction.reply(
			`Clique ici pour connecter ta chaîne YouTube : ${authUrl}`
		);
	}

	if (interaction.commandName === 'refresh') {
		const user = await prisma.user.findUnique({
			where: { discordId: interaction.user.id },
		});
		if (!user) {
			await interaction.reply(
				"Tu n'as pas encore lié ta chaîne YouTube avec /link"
			);
			return;
		}

		const result = await refreshUserData(user);
		await interaction.reply(result.message);
	}

	if (interaction.commandName === 'leaderboard') {
		const league = interaction.options.getString('league') || 'Bronze';
		const leagueData = leagues.find(
			(l) => l.name.toLowerCase() === league.toLowerCase()
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
	}
});

// ============ EXPRESS OAUTH ============

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

			// Log the tokens we received
			console.log('Received tokens:', {
				hasAccessToken: !!tokens.access_token,
				hasRefreshToken: !!tokens.refresh_token,
				tokenType: tokens.token_type,
			});

			if (!tokens.access_token || !tokens.refresh_token) {
				console.error('Missing tokens:', tokens);
				res.send(
					"Erreur: Impossible d'obtenir les tokens nécessaires. Veuillez réessayer."
				);
				return;
			}

			oauth2Client.setCredentials(tokens);

			const me = await youtube.channels.list({
				mine: true,
				part: ['snippet', 'statistics'],
			});
			const channel = me.data.items?.[0];
			if (!channel) {
				res.send('Impossible de trouver la chaîne YouTube');
				return;
			}

			const youtubeId = channel.id || '';
			const youtubeName = channel.snippet?.title || 'Inconnu';
			const subscriberCount = parseInt(
				channel.statistics?.subscriberCount || '0'
			);
			const league =
				leagues.filter((l) => subscriberCount >= l.minSubs).pop()
					?.name || 'Bronze';

			// Log before database operation
			console.log('Storing user data:', {
				discordId: state,
				youtubeId,
				hasAccessToken: !!tokens.access_token,
				hasRefreshToken: !!tokens.refresh_token,
			});

			const user = await prisma.user.upsert({
				where: { discordId: state as string },
				update: {
					youtubeId,
					youtubeName,
					subscriberCount,
					league,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
				},
				create: {
					discordId: state as string,
					youtubeId,
					youtubeName,
					subscriberCount,
					league,
					accessToken: tokens.access_token,
					refreshToken: tokens.refresh_token,
				},
			});

			// Log after database operation
			console.log('User data stored:', {
				id: user.id,
				hasAccessToken: !!user.accessToken,
				hasRefreshToken: !!user.refreshToken,
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

app.listen(3000, () =>
	console.log('🌐 Serveur Express lancé sur http://localhost:3000')
);

// ============ ENREGISTRER LES COMMANDES DISCORD ============
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

// ============ DÉMARRER LE BOT ============
discordClient.login(process.env.DISCORD_TOKEN);

// Function to update leaderboard channel
async function updateLeaderboardChannel(channelId: string, leagueName: string) {
	const channel = await discordClient.channels.fetch(channelId);
	if (!channel || !(channel instanceof TextChannel)) return;

	const users = await prisma.user.findMany({
		where: { league: leagueName },
		orderBy: { subscriberCount: 'desc' },
	});

	let message = `🏆 Classement ${leagueName} 🏆\n\n`;
	users.forEach((user, index) => {
		message += `${index + 1}. ${
			user.youtubeName
		} - ${user.subscriberCount.toLocaleString()} abonnés\n`;
	});

	// Delete previous messages
	const messages = await channel.messages.fetch({ limit: 10 });
	await Promise.all(messages.map((msg) => msg.delete()));

	// Send new leaderboard
	await channel.send(message);
}

// Function to refresh user's data
async function refreshUserData(user: any) {
	try {
		// Log user data before refresh
		console.log('Starting refresh for user:', {
			discordId: user.discordId,
			hasAccessToken: !!user.accessToken,
			hasRefreshToken: !!user.refreshToken,
			currentLeague: user.league,
		});

		// Set initial credentials
		oauth2Client.setCredentials({
			access_token: user.accessToken,
			refresh_token: user.refreshToken,
		});

		// Try to refresh the token
		try {
			if (!user.refreshToken) {
				console.error(
					'No refresh token found for user:',
					user.discordId
				);
				throw new Error('No refresh token available');
			}

			console.log('Attempting token refresh...');
			const { credentials } = await oauth2Client.refreshAccessToken();
			console.log('Token refresh successful:', {
				hasNewAccessToken: !!credentials.access_token,
				hasNewRefreshToken: !!credentials.refresh_token,
			});

			if (credentials.access_token) {
				await prisma.user.update({
					where: { discordId: user.discordId },
					data: {
						accessToken: credentials.access_token,
						refreshToken:
							credentials.refresh_token || user.refreshToken,
					},
				});
				// Update the credentials with the new token
				oauth2Client.setCredentials({
					access_token: credentials.access_token,
					refresh_token:
						credentials.refresh_token || user.refreshToken,
				});
			}
		} catch (refreshError) {
			console.error('Error refreshing token:', refreshError);
			// If token refresh fails and we don't have a valid access token, ask user to relink
			if (!user.accessToken) {
				return {
					success: false,
					message:
						'Erreur de connexion à YouTube. Veuillez relier votre chaîne avec /link',
				};
			}
			// If we have an access token, continue with it
		}

		// Get channel data
		const me = await youtube.channels.list({
			mine: true,
			part: ['snippet', 'statistics'],
		});

		const channel = me.data.items?.[0];
		if (!channel) {
			throw new Error('Channel not found');
		}

		const subs = parseInt(channel.statistics?.subscriberCount || '0');
		const newLeague =
			leagues.filter((l) => subs >= l.minSubs).pop()?.name || 'Bronze';

		const oldLeague = user.league;
		await prisma.user.update({
			where: { discordId: user.discordId },
			data: {
				subscriberCount: subs,
				league: newLeague,
			},
		});

		// Update both old and new league leaderboards
		if (oldLeague !== newLeague) {
			const oldLeagueChannel = leagues.find(
				(l) => l.name === oldLeague
			)?.channelId;
			const newLeagueChannel = leagues.find(
				(l) => l.name === newLeague
			)?.channelId;

			if (oldLeagueChannel)
				await updateLeaderboardChannel(oldLeagueChannel, oldLeague);
			if (newLeagueChannel)
				await updateLeaderboardChannel(newLeagueChannel, newLeague);

			return {
				success: true,
				message: `👏 Félicitations ! Tu passes de ${oldLeague} à ${newLeague} !`,
				leagueChanged: true,
			};
		} else {
			const currentLeagueChannel = leagues.find(
				(l) => l.name === newLeague
			)?.channelId;
			if (currentLeagueChannel)
				await updateLeaderboardChannel(currentLeagueChannel, newLeague);
			return {
				success: true,
				message: `Tu es toujours en ligue ${oldLeague} avec ${subs.toLocaleString()} abonnés.`,
				leagueChanged: false,
			};
		}
	} catch (error) {
		console.error('Error in refreshUserData:', error);
		if (error instanceof Error) {
			return {
				success: false,
				message: `Erreur lors de la mise à jour : ${error.message}`,
			};
		}
		return {
			success: false,
			message:
				'Une erreur inconnue est survenue lors de la mise à jour de tes données.',
		};
	}
}
