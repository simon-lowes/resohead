FROM node:22-alpine
WORKDIR /app
COPY site/ ./
# Re-join files committed in parts (see tools/split-large.sh).
RUN find public -name '*.part-aa' | while read -r f; do \
      base="${f%.part-aa}"; cat "$base".part-* > "$base" && rm "$base".part-*; \
    done \
 && mkdir -p /data && chown node:node /data
USER node
ENV PORT=3000 DATA_DIR=/data NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.mjs"]
