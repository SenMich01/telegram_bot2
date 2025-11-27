# Use Node.js LTS version
FROM node:18-alpine

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 8080

# Start the bot
CMD ["node", "dist/main.js"]
```

3. **Save the file**

---

### Step 4: Create `.dockerignore`

**Location:** Root of your project

1. **New File** → Name it: `.dockerignore`
2. **Open it** and paste this:
```
node_modules
npm-debug.log
dist
.env
.git
.gitignore
README.md
logs
*.log
config.json
users.json