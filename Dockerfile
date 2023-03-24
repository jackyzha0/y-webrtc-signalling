# Base Image
FROM node:lts-bullseye-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package.json ./
COPY package-lock.json ./
RUN npm ci

# Copy source code and static files
COPY . .

# Run app
CMD [ "node", "server.js" ]
