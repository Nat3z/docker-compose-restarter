# Jellyfin Restarter

A simple web interface to restart all Docker Compose containers with a single button click.

## Features

- Simple, clean web UI with a single "Restart All" button
- Real-time status monitoring (Online/Offline)
- Exponential backoff polling after restart to detect when containers are back online
- Activity logs showing restart progress
- Fully containerized with Docker

## Prerequisites

- Docker
- Docker Compose
- Bun (for local development only)

## Quick Start

### Running with Docker Compose

1. Clone this repository or copy the files to your directory

2. Build and start the container:
```bash
docker-compose up -d --build
```

3. Access the web interface at `http://localhost:3000`

4. Click "Restart All" to restart all containers in the compose file

### Configuration

The application can be configured via environment variables in `docker-compose.yml`:

- `PORT`: The port the web server runs on (default: 3000)
- `COMPOSE_FILE`: Path to the docker-compose.yml file to restart (default: /docker-compose/docker-compose.yml)
- `CRITICAL_SERVICES`: Comma-separated list of service names to stop first before stopping all other services (optional)

#### Critical Services

You can specify critical services that should be stopped first before shutting down everything else. This is useful for services that need graceful shutdown or have dependencies that should stop in a specific order.

Example configuration:
```yaml
environment:
  - CRITICAL_SERVICES=jellyfin,plex,database
```

When a restart is triggered:
1. Critical services are stopped one by one in the order specified
2. System waits 2 seconds for graceful shutdown
3. All remaining services are stopped
4. All services are started back up

### Volume Mounts

The container requires two volume mounts:

1. `/var/run/docker.sock:/var/run/docker.sock` - Allows the container to control Docker
2. `./:/docker-compose:ro` - Mounts the compose file directory (read-only)

## Local Development

1. Install dependencies:
```bash
bun install
```

2. Run the development server:
```bash
bun run dev
```

3. Access the application at `http://localhost:3000`

Note: For local development, you'll need to have Docker and docker-compose available in your PATH, and adjust the `COMPOSE_FILE` environment variable to point to your docker-compose.yml file.

## How It Works

1. The web interface displays the current status of your containers
2. When you click "Restart All", it sends a POST request to `/api/restart`
3. The server executes `docker compose restart` on the specified compose file
4. The client begins polling with exponential backoff (starting at 1s, max 30s)
5. Once containers are detected as online, status updates to "Online"

## Security Notes

- This application requires access to the Docker socket, which gives it significant control over your Docker environment
- Only expose this service on trusted networks
- Consider adding authentication if exposing publicly
- The compose file directory is mounted read-only for safety

## License

MIT
