FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.js"]
