# FixedCoin Node (Umbrel App)

Run a standalone FixedCoin (FIX) full node on Umbrel with a built-in live UI.

## Includes

- `fixedcoind` full node service
- Auto-download of official FixedCoin Linux binaries at container start
- Live dashboard UI with 5-second refresh
- MiningCore integration hints (RPC host/port/user)

## Default ports

- P2P: `24768`
- RPC: `24761`
- ZMQ rawblock: `24763`
- ZMQ rawtx: `24764`
- ZMQ hashtx: `24765`
- ZMQ hashblock: `24766`

## Configuration

Edit `docker-compose.yml` as needed:

- `RPC_USER`
- `RPC_PASSWORD` (set a strong value)
- `EXTRA_ADDNODES` (comma-separated host:port list)

Node data persists in:

- `${APP_DATA_DIR}/fixedcoin-data`

## Works with MiningCore dashboard

Your `retro-mikes-miningcore-dashboard` app will display FIX once your MiningCore pool exposes FIX in `/api/pools`.

Price mapping for FIX is already included in the dashboard backend (`FIX -> fixedcoin`).
