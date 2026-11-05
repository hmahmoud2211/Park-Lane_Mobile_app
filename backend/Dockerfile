# The whole backend as one image: accounts, smart home, Health Passport, the clinic and its
# admin tool (scripts/clinic.ts), on Node alone. Settings (.env), the database and the files
# stay outside it, so a new image never touches them: compose.yaml attaches them on the server,
# and `docker run` with a volume does anywhere else (README, "Run it in Docker").
FROM node:22.23.4-slim

ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

WORKDIR /app
# No npm install: the backend only uses what ships with Node.
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Where the data goes unless DATA_DIR says otherwise. Owned by the user below, and a new volume
# mounted here takes that owner, so the backend can write to it.
RUN mkdir data && chown node:node data

# uid 1000, the host user that owns the data folder, so its files stay readable there.
USER node

CMD ["node", "src/index.ts"]
