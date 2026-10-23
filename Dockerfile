# syntax=docker/dockerfile:1.7
# The named browser-harness context is the local extension-capable checkout.
ARG GO_VERSION=1.27.2
FROM golang:${GO_VERSION}-bookworm AS dashboard
WORKDIR /src
COPY dashboard/go.mod dashboard/go.sum ./
RUN go mod download
COPY dashboard/ ./
RUN CGO_ENABLED=0 go build -buildvcs=false -o /career-dashboard .

FROM node:24-bookworm AS runtime-base
ARG CHROME_VERSION=156.0.8078.47
ARG CHROME_SHA256=e6c94490f0b6b337225aeb2d2a5034858516b7017356980ba94f5176d8774a50
ARG CODEX_VERSION=0.162.1
ARG LINKEDIN_MCP_VERSION=4.28.0
ARG LINKEDIN_PYTHON_VERSION=3.13.9
ENV DEBIAN_FRONTEND=noninteractive PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git tini python3 python3-venv unzip \
    xvfb xauth openbox x11vnc novnc websockify xdotool x11-utils dbus-x11 \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libgtk-3-0 fonts-liberation fonts-noto-color-emoji \
    latexmk texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-xetex \
    && rm -rf /var/lib/apt/lists/*
# Chrome for Testing retains unpacked-extension startup support. No debugging port.
RUN test "$(dpkg --print-architecture)" = amd64 \
    && curl -fsSL "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" -o /tmp/chrome.zip \
    && echo "${CHROME_SHA256}  /tmp/chrome.zip" | sha256sum -c - \
    && unzip -q /tmp/chrome.zip -d /opt \
    && mkdir -p /opt/google/chrome \
    && ln -s /opt/chrome-linux64/chrome /opt/google/chrome/chrome \
    && ln -s /opt/chrome-linux64/chrome /usr/local/bin/google-chrome \
    && chown root:root /opt/chrome-linux64/chrome_sandbox \
    && chmod 4755 /opt/chrome-linux64/chrome_sandbox \
    && rm /tmp/chrome.zip
RUN python3 -m venv /opt/uv && /opt/uv/bin/pip install --no-cache-dir uv==0.10.7 \
    && npm install -g --no-audit --no-fund "@openai/codex@${CODEX_VERSION}"
# Same server as the LinkedIn plugin; install at build time, never via runtime uvx.
# Keep its newer Python and dependencies separate from Browser Harness.
ENV UV_PYTHON_INSTALL_DIR=/opt/python
RUN /opt/uv/bin/uv venv --python ${LINKEDIN_PYTHON_VERSION} /opt/linkedin \
    && /opt/uv/bin/uv pip install --python /opt/linkedin/bin/python "mcp-server-linkedin==${LINKEDIN_MCP_VERSION}" \
    && /opt/linkedin/bin/mcp-server-linkedin --help >/dev/null
COPY --from=browser-harness /pyproject.toml /uv.lock /LICENSE /EXTENSIONS.md /opt/browser-harness/
COPY --from=browser-harness /src/ /opt/browser-harness/src/
RUN /opt/uv/bin/uv sync --directory /opt/browser-harness --frozen --no-dev --no-editable \
    && BH_TELEMETRY=0 /opt/browser-harness/.venv/bin/browser-harness extension package chrome /opt/browser-harness/chrome-extension
ENV PATH=/opt/browser-harness/.venv/bin:$PATH

FROM runtime-base AS app-build
WORKDIR /opt/career-ops
# The root has no committed npm lockfile; web/ does. Do not generate host locks.
COPY package.json ./
RUN npm install --no-audit --no-fund --package-lock=false \
    && npx --no-install playwright install --with-deps chromium \
    && node --input-type=module -e "import { chromium } from 'playwright'; import fs from 'node:fs'; fs.accessSync(chromium.executablePath())"
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci --no-audit --no-fund
COPY . .
# The pinned server's October button markup needs a read-only job-record lookup.
# Context checks make an upstream source change fail the build, not skip the fix.
RUN cd /opt/linkedin/lib/python3.13/site-packages \
    && git apply --check /opt/career-ops/container/linkedin-apply.patch \
    && git apply /opt/career-ops/container/linkedin-apply.patch
# Runtime imports must work from the filtered source tree, not just Next's build.
RUN node doctor.mjs --json && node --input-type=module -e "import './tracker-parse.mjs'" \
    && npm --prefix web run build

FROM app-build AS app
COPY --from=dashboard /career-dashboard /usr/local/bin/career-dashboard
COPY --chmod=755 container/linkedin.py /usr/local/bin/career-ops-linkedin
ENV NODE_ENV=production HOME=/home/node DISPLAY=:99 \
    CAREER_OPS_CODE_ROOT=/opt/career-ops CAREER_OPS_ROOT=/data \
    CAREER_OPS_BROWSER_HARNESS_BIN=/opt/browser-harness/.venv/bin/browser-harness \
    BH_BACKEND=extension BU_NAME=career-ops BH_CONFIG_DIR=/home/node/.config/browser-harness \
    BH_RUNTIME_DIR=/tmp/browser-harness BH_TMP_DIR=/tmp/browser-harness-output \
    BH_TELEMETRY=0 BH_DOMAIN_SKILLS=0 BH_RECORD=0
RUN mkdir -p /data /home/node/chrome-profile /home/node/.config \
    && chown -R node:node /data /home/node /opt/career-ops/web/.next
USER node
WORKDIR /opt/career-ops
EXPOSE 3000 6080
HEALTHCHECK --interval=30s --timeout=8s --start-period=90s --retries=3 \
    CMD ["python3", "/opt/career-ops/container/healthcheck.py"]
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/opt/career-ops/container/entrypoint.py"]
CMD ["serve"]
