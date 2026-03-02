FROM python:3.12-slim

WORKDIR /app

# Install Python deps
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source + static assets
COPY . .

ENV GDUEL_HOST=0.0.0.0 \
    GDUEL_PORT=8000 \
    GDUEL_STATIC=/app

EXPOSE 8000

CMD ["python", "server.py"]
