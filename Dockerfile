FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node dist ./dist
COPY --chown=node:node server.mjs presence.mjs ./
ENV HOST=0.0.0.0
ENV PORT=3000
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
