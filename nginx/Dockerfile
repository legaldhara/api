# Stage 1: Admin
FROM node:20-alpine AS admin_builder
WORKDIR /app
COPY ./admin/package*.json ./
RUN npm install
COPY ./admin ./
RUN npm run build

# Stage 2: Website
FROM node:20-alpine AS website_builder
WORKDIR /app
COPY ./website/package*.json ./
RUN npm install
COPY ./website ./
RUN npm run build

# Stage 3: Nginx
FROM nginx:alpine
RUN rm -rf /usr/share/nginx/html/*

COPY --from=admin_builder /app/dist /usr/share/nginx/html/admin
COPY --from=website_builder /app/out /usr/share/nginx/html/website

# Copy custom Nginx config
COPY ./nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
