FROM node:20-slim

# Install ffmpeg, chromium, and yt-dlp for video processing
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && wget -qO /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
