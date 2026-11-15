# The image student programs run in (see server/services/codeRunner/docker.ts). It holds only the language tools:
# no network is given to the container, and it runs as an unprivileged user with a read-only file system.
#
#   docker build -t bwenge-code-runner:latest docker/code-runner
#
# Set CODE_RUNNER_IMAGE to use another name. Add languages by adding their packages here and an entry in
# server/services/codeRunner/languages.ts.
FROM debian:12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 nodejs gcc g++ libc6-dev default-jdk-headless coreutils procps \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -u 65534 -M -s /usr/sbin/nologin runner 2>/dev/null || true
WORKDIR /work
