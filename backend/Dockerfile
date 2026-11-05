# The backend as one image: Node and the code in backend/, nothing else. Settings (.env),
# the database and the units' Home Assistant folders stay on the host and are attached by
# compose.yaml, so a new image never touches them.
FROM node:22.23.4-slim

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
# No npm install: the backend only uses what ships with Node.
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# uid 1000, the host user that owns the data folder, so its files stay readable there.
USER node

CMD ["node", "src/index.ts"]
