# RESQORA backend. node:sqlite needs Node 22.5+; 24 has it unflagged.
FROM node:24-alpine

WORKDIR /app

# Install dependencies first so code changes do not rebuild this layer.
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# The database file and SOS photos must survive a redeploy: mount a volume here.
ENV DB_PATH=/data/database.db \
    UPLOAD_DIR=/data/uploads \
    PORT=3000 \
    NODE_ENV=production
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["node", "index.js"]
