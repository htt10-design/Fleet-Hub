# PocketBase "privat" – eigene Instanz für SGS Pro und weitere private Apps
FROM alpine:3.20
ARG PB_VERSION=0.40.6
ARG TARGETARCH
RUN apk add --no-cache ca-certificates unzip wget \
 && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" -O /tmp/pb.zip \
 && unzip /tmp/pb.zip -d /pb && rm /tmp/pb.zip \
 && adduser -D -H -u 10001 pb && mkdir -p /pb/pb_data && chown -R pb /pb
USER pb
EXPOSE 8090
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data"]
