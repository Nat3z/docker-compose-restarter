FROM oven/bun:1 AS base
WORKDIR /app

# Install curl and Docker CLI
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSLO https://get.docker.com/builds/Linux/x86_64/docker-17.03.1-ce.tgz && \
    tar --strip-components=1 -xvzf docker-17.03.1-ce.tgz -C /usr/local/bin && \
    rm docker-17.03.1-ce.tgz && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json ./
RUN bun install

# Copy application code
COPY src ./src

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]
