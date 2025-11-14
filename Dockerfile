FROM oven/bun:1 AS base
WORKDIR /app

# Install curl and Docker CLI
RUN apt-get update && \
    apt-get -qy full-upgrade && \
    apt-get install -qy curl && \
    apt-get install -qy curl && \
    curl -sSL https://get.docker.com/ | sh

# Install dependencies
COPY package.json ./
RUN bun install

# Copy application code
COPY src ./src

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]
