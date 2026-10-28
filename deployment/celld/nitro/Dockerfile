FROM ubuntu:24.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates iproute2 socat util-linux \
    && rm -rf /var/lib/apt/lists/*

# Supply the existing verified Linux build as a named Docker build context.
COPY --from=runtime /celld /opt/seams/celld
COPY nitro.sh /opt/seams/nitro.sh
RUN chmod 755 /opt/seams/celld /opt/seams/nitro.sh \
    && /opt/seams/celld --version

ENTRYPOINT ["/opt/seams/nitro.sh", "enclave"]
