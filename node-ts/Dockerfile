FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY media ./media
RUN mkdir -p /app/genesis /app/wallets /app/data
EXPOSE 30334 9944 8080 8545
ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["--help"]