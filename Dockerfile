# Stage 1: build the plugin
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build && cp package.json dist/package.json

# Stage 2: minimal init-container image
# On pod startup, copies plugin files into the shared plugins volume:
#   initContainers:
#     - name: crossplane-plugin
#       image: ghcr.io/builver/headlamp-plugin-crossplane:<tag>
#       volumeMounts:
#         - name: headlamp-plugins
#           mountPath: /target
FROM alpine:3
COPY --from=builder /app/dist/main.js /headlamp/plugins/headlamp-plugin-crossplane/main.js
COPY --from=builder /app/dist/package.json /headlamp/plugins/headlamp-plugin-crossplane/package.json
CMD ["cp", "-r", "/headlamp/plugins/.", "/target/"]
