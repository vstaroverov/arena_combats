FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node dist ./dist
COPY --chown=node:node server.mjs presence.mjs world.mjs game.mjs store.mjs ./
COPY --chown=node:node scripts/backup.mjs ./scripts/backup.mjs
RUN mkdir -p /app/data && chown node:node /app/data
ENV HOST=0.0.0.0
ENV PORT=3000
ENV WORLD_DB=/app/data/world.sqlite
VOLUME ["/app/data"]
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
