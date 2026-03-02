FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm install typescript ts-node --save-dev
RUN npx tsc

EXPOSE 5001

CMD ["node", "dist/server.js"]
