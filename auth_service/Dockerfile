FROM python:3.11-slim
WORKDIR /app

# Install dependencies
COPY auth_service/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy source
COPY auth_service/ .

# Expose port
EXPOSE 8000

# Run
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
