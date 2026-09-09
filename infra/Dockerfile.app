FROM node:22-alpine
WORKDIR /app
COPY dist/index.js ./dist/index.js
# Uploads are spooled under the temp directory; nothing else is written.
USER node
CMD ["node", "dist/index.js"]
