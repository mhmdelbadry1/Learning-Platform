FROM python:3.11-slim
WORKDIR /app

# Install ffmpeg for pydub audio conversion
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

COPY stt_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY common /common
COPY stt_service /app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]