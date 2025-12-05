FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Allow passing the API base at build time
ARG VITE_API_BASE_URL
RUN echo "VITE_API_BASE_URL=${VITE_API_BASE_URL:-http://localhost:5001}" > .env.production

RUN npm run build:prod

FROM nginx:stable-alpine

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# Add a minimal nginx config to support SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
