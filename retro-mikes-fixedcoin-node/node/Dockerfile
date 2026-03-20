FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/fixedcoin
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
