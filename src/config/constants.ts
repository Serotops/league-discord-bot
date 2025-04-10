export const LEAGUES = [
	{ name: 'Bronze', minSubs: 0, channelId: process.env.BRONZE_CHANNEL_ID },
	{ name: 'Silver', minSubs: 1000, channelId: process.env.SILVER_CHANNEL_ID },
	{ name: 'Gold', minSubs: 10000, channelId: process.env.GOLD_CHANNEL_ID },
	{
		name: 'Platinum',
		minSubs: 100000,
		channelId: process.env.PLATINUM_CHANNEL_ID,
	},
] as const;

export const YOUTUBE_SCOPES = [
	'https://www.googleapis.com/auth/youtube.readonly',
];
