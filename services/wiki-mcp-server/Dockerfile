# syntax=docker/dockerfile:1
FROM --platform=linux/arm64 node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src/ ./src/

CMD ["node", "src/index.js"]
