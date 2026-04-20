FROM node:22-bookworm-slim

# Build tools needed for node-curl-impersonate native addon
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

ENV PORT=3001
EXPOSE 3001

CMD ["node", "index.js"]
