FROM node:20.19-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20.19-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

EXPOSE 8787

CMD ["npm", "run", "server"]
