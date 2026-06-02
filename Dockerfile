FROM shootgoal-tv-frontend:latest@sha256:b235c4868d48db8463736cfc402f989ddee576cf9b5ab948c74284f0a8b2ddb6

WORKDIR /app

USER root
RUN mkdir -p /app/.data /app/src/data/templates /app/docker \
  && touch /app/.data/.keep \
  && chown -R 1001:65534 /app/.data

COPY --chown=1001:65534 index.html package.json /app/
COPY --chown=1001:65534 src/main.js src/workflow.js src/styles.css /app/src/
COPY --chown=1001:65534 src/data/templateManifest.json /app/src/data/
COPY --chown=1001:65534 src/data/templates /app/src/data/templates
COPY --chown=1001:65534 docker/static-server.mjs /app/docker/static-server.mjs

USER 1001:65534
EXPOSE 4173

ENTRYPOINT ["node", "/app/docker/static-server.mjs"]
