# MiningCore Live Dashboard (Umbrel App)

Standalone Umbrel dashboard for Retro-Mike's MiningCore. This app does **not** modify any installed app code.
It only reads current data from:

- MiningCore API (`/api/pools`, `/api/pools/{poolId}/blocks`)
- CoinGecko realtime USD pricing

## Metrics shown

- Network hashrate
- Network difficulty
- Current price in USD
- Possible blocks per day
- Blocks found from solo pool
- Reward from found blocks
- Immature to mature confirmation progress (%)

## Refresh behavior

- UI refreshes every 5 seconds by default (`REFRESH_INTERVAL_SECONDS=5`)
- Backend also refreshes/caches live data on that cadence

## Node add/subtract behavior

- Nodes are auto-discovered from MiningCore on every refresh
- New nodes are automatically included
- Use `+ Include` / `- Exclude` per node to control visibility
- Excluded nodes are stored in browser local storage

## Configure your MiningCore source

Edit `docker-compose.yml` and set:

- `MININGCORE_API_BASE_URL` to your live MiningCore API endpoint
- Optional: `COINGECKO_SYMBOL_MAP` for symbols not in the built-in map  
  format: `SYMBOL=coingecko-id,SYMBOL2=coingecko-id2`

Example values (change for your environment):

- `http://retro-mikes-miningcore_server_1:4000`
- `http://10.0.0.25:4000`

## Files

- `umbrel-app.yml` - Umbrel app metadata
- `docker-compose.yml` - Umbrel services and environment
- `dashboard/server.js` - backend API + static file server
- `dashboard/public/` - frontend UI
