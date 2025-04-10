-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "discordId" TEXT NOT NULL,
    "youtubeId" TEXT NOT NULL,
    "youtubeName" TEXT NOT NULL,
    "subscriberCount" INTEGER NOT NULL,
    "league" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "User_youtubeId_key" ON "User"("youtubeId");
