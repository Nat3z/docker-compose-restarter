FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json ./
RUN bun install

# Copy application code
COPY src ./src

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]
