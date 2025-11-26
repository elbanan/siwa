# Siwa (Local-first) v0.1

Siwa keeps your datasets, models, and evaluations on your machine while still letting you package everything in Docker when you’re ready to share the stack.

## Local development

1. **API**
   ```bash
   cd apps/siwa-api
   cp .env.example .env
   python3.11 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   bash run.sh
   ```
   The `.env` file controls where artifacts land (`SIWA_HOME`, default `./data`). Edit that file anytime you want to point Siwa at a different local folder.

2. **Web client**
   ```bash
   cd ../siwa-web
   npm install
   cp .env.local.example .env.local
   npm run dev
   ```
   The client talks to `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`), so start the API first or update the URL to match a remote host.

## Docker packaging

Before you run `docker compose build`/`docker compose up`, you can still tweak the data folder that the API mounts by editing `apps/siwa-api/.env.docker` (`SIWA_HOME=/siwa/data` by default). Pointing that value at a host directory lets you access the files directly from your machine once the container is running.

To build and run the stack:
```bash
docker compose build
docker compose up --build
```

If you publish the images, swap the `build` blocks in `docker-compose.yml` for `image: <registry>/siwa/api:<version>` and `image: <registry>/siwa/web:<version>` so downstream teams can pull the released tags.

## External data example

If you want to keep all datasets and runs in a predictable host folder, here is one way to do it:

```bash
# In your main .env file, set EXTERNAL_DATA_PATH
EXTERNAL_DATA_PATH=/Users/user/my-data

# Ensure the API knows where to store artifacts locally
cd apps/siwa-api
sed -i '' "s|SIWA_HOME=.*|SIWA_HOME=$EXTERNAL_DATA_PATH|" .env
sed -i '' "s|SIWA_HOME=.*|SIWA_HOME=$EXTERNAL_DATA_PATH|" .env.docker

# In docker-compose.yml bind the same folder into `/siwa/data`
# using the environment variable in the volume declaration
# (example: `${EXTERNAL_DATA_PATH:-./data}:/siwa/data`)
```

After that, run the API and web client locally or build the Docker stack—both environments will read/write the same shared folder.

## Quick tips

- Keep your `.env` files (`.env`, `.env.local`, `.env.docker`) in sync with the services you are running.
- Map a host volume to the API’s `SIWA_HOME` path so datasets, runs, and the SQLite file survive container restarts.
- If you want the data folder on your host machine to be shared with the app, uncomment and set `EXTERNAL_DATA_PATH` in `.env`, update `apps/siwa-api/.env` and `.env.docker` so `SIWA_HOME` points there, and make sure your Compose volume (e.g. `${EXTERNAL_DATA_PATH:-./data}:/siwa/data`) mounts that path before you build/package Docker.
