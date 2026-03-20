#!/usr/bin/env bash
set -euo pipefail

FIXEDCOIN_RELEASE="${FIXEDCOIN_RELEASE:-v29.1.2}"
RPC_USER="${RPC_USER:-fixrpc}"
RPC_PASSWORD="${RPC_PASSWORD:-replace-with-strong-password}"
RPC_PORT="${RPC_PORT:-24761}"
P2P_PORT="${P2P_PORT:-24768}"
ZMQ_RAWBLOCK_PORT="${ZMQ_RAWBLOCK_PORT:-24763}"
ZMQ_RAWTX_PORT="${ZMQ_RAWTX_PORT:-24764}"
ZMQ_HASHTX_PORT="${ZMQ_HASHTX_PORT:-24765}"
ZMQ_HASHBLOCK_PORT="${ZMQ_HASHBLOCK_PORT:-24766}"
EXTRA_ADDNODES="${EXTRA_ADDNODES:-}"

DATA_DIR="/data"
BIN_DIR="/opt/fixedcoin/bin"
mkdir -p "$DATA_DIR" "$BIN_DIR"

release_version="${FIXEDCOIN_RELEASE#v}"

case "$(uname -m)" in
  x86_64|amd64)
    arch_suffix="x86_64-linux-gnu"
    ;;
  aarch64|arm64)
    arch_suffix="aarch64-linux-gnu"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)"
    exit 1
    ;;
esac

if [[ ! -x "$BIN_DIR/fixedcoind" ]]; then
  archive="fixedcoin-${release_version}-${arch_suffix}.tar.gz"
  url="https://github.com/Fixed-Blockchain/fixedcoin/releases/download/${FIXEDCOIN_RELEASE}/${archive}"

  echo "Downloading $url"
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  curl -fsSL "$url" -o "$tmp_dir/fixedcoin.tar.gz"
  tar -xzf "$tmp_dir/fixedcoin.tar.gz" -C "$tmp_dir"

  extracted_root="$(find "$tmp_dir" -maxdepth 1 -type d -name "fixedcoin-*" | head -n1)"
  if [[ -z "$extracted_root" ]]; then
    echo "Could not find extracted FixedCoin directory"
    exit 1
  fi

  cp "$extracted_root"/bin/* "$BIN_DIR"/
  chmod +x "$BIN_DIR"/*
fi

CONF_FILE="$DATA_DIR/fixedcoin.conf"
if [[ ! -f "$CONF_FILE" ]]; then
  cat > "$CONF_FILE" <<EOF
# Generated automatically on first launch. Edit this file for custom node settings.
server=1
listen=1
txindex=1
rpcuser=${RPC_USER}
rpcpassword=${RPC_PASSWORD}
rpcbind=0.0.0.0
rpcallowip=0.0.0.0/0
rpcport=${RPC_PORT}
port=${P2P_PORT}
maxconnections=125
addnode=node1.fixedcoin.org
addnode=node2.fixedcoin.org
zmqpubrawblock=tcp://0.0.0.0:${ZMQ_RAWBLOCK_PORT}
zmqpubrawtx=tcp://0.0.0.0:${ZMQ_RAWTX_PORT}
zmqpubhashtx=tcp://0.0.0.0:${ZMQ_HASHTX_PORT}
zmqpubhashblock=tcp://0.0.0.0:${ZMQ_HASHBLOCK_PORT}
daemon=0
printtoconsole=1
EOF

  if [[ -n "$EXTRA_ADDNODES" ]]; then
    IFS=',' read -ra nodes <<< "$EXTRA_ADDNODES"
    for node in "${nodes[@]}"; do
      trimmed="$(echo "$node" | xargs)"
      if [[ -n "$trimmed" ]]; then
        echo "addnode=$trimmed" >> "$CONF_FILE"
      fi
    done
  fi
fi

exec "$BIN_DIR/fixedcoind" -datadir="$DATA_DIR" -conf="$CONF_FILE" -printtoconsole
