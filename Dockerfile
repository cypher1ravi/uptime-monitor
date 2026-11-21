# Cloud Run job image. Node 22+ runs the .ts files directly (type stripping).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY sites.json ./
USER node
CMD ["node", "src/run.ts"]
