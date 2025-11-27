FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
COPY tsconfig.json ./
RUN npm install
COPY . .
RUN npm run build
RUN mkdir -p logs
EXPOSE 8080
CMD ["node", "dist/main.js"]