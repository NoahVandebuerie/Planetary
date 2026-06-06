FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv curl && \
    rm -rf /var/lib/apt/lists/* && \
    ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend/requirements.txt backend/requirements.txt
RUN python -m pip install --no-cache-dir --break-system-packages -r backend/requirements.txt

COPY . .

RUN chmod +x start.sh

EXPOSE 3000

CMD ["./start.sh"]
