FROM jenkins/jenkins:lts-jdk21

COPY --chown=jenkins:jenkins plugins.txt /usr/share/jenkins/ref/plugins.txt
COPY --chown=jenkins:jenkins init.groovy.d/ /usr/share/jenkins/ref/init.groovy.d/

RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

USER root

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=22.14.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git xz-utils \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in \
        amd64) node_arch="x64" ;; \
        arm64) node_arch="arm64" ;; \
        *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; \
    esac \
    && curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
    && rm "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && npm install -g playwright \
    && playwright install --with-deps chromium \
    && mkdir -p /var/jenkins_results /ms-playwright \
    && chown -R jenkins:jenkins /var/jenkins_results /ms-playwright \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/*

USER jenkins
