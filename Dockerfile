FROM node:20-alpine

WORKDIR /app

# 先复制依赖清单，利用层缓存
COPY package.json ./
RUN npm install --omit=dev

# 复制应用代码
COPY server.js ./
COPY src ./src
COPY public ./public

EXPOSE 3000

CMD ["node", "server.js"]
