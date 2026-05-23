FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM busybox:1.36
COPY --from=build /app/dist /var/www
EXPOSE 80
CMD ["busybox", "httpd", "-f", "-p", "80", "-h", "/var/www"]
