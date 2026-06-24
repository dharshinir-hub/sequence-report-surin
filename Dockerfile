# ---- Base image -------------------------------------------------------------
# Alpine is a small Linux; node:20 matches the Node version this app was built on.
FROM node:20-alpine

# Everything below happens inside /app in the container.
WORKDIR /app

# ---- Install dependencies (cached layer) ------------------------------------
# Copy only the manifests first. Docker caches this layer, so dependencies are
# re-installed ONLY when package.json / package-lock.json change, not on every
# code edit. --omit=dev skips nodemon (a dev-only tool we don't need in prod).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Copy application code --------------------------------------------------
COPY . .

# The app reads REPORTS_PORT from the environment (default 6005, set to 6016 in
# .env). EXPOSE is documentation only; actual mapping is done with -p at runtime.
EXPOSE 6016

# ---- Start ------------------------------------------------------------------
CMD ["node", "index.js"]
