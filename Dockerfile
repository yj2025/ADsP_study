FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node dist ./dist
COPY --chown=node:node content ./content
COPY --chown=node:node scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
ENV BIND_HOST=0.0.0.0 PORT=4173 DATABASE_PATH=/data/study.sqlite
CMD ["node", "src/server.cjs"]
