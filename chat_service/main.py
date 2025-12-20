import os
import json
import threading
import boto3
import psycopg2
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
import sys

sys.path.append("..")
from common.kafka_consumer import create_consumer
from common.kafka_producer import send_event

load_dotenv()

app = FastAPI(title="Chat Completion Service", version="1.0.0")

# --- Configuration ---
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET = os.getenv("CHAT_BUCKET_NAME")
DB_HOST = os.getenv("DB_HOST")
DB_USER = os.getenv("DB_USER")
DB_PASS = os.getenv("DB_PASSWORD")
DB_NAME = os.getenv("DB_NAME")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Initialize Gemini AI
if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-2.0-flash')
else:
    model = None
    print("WARNING: GEMINI_API_KEY not configured. Chat will use placeholder responses.")

s3_client = boto3.client('s3', region_name=AWS_REGION)

class ChatRequest(BaseModel):
    user_id: str
    message: str
    stream: bool = True

class ChatHistoryRequest(BaseModel):
    user_id: str
    limit: int = 20

def get_db_connection():
    try:
        return psycopg2.connect(
            host=DB_HOST, database=DB_NAME, user=DB_USER, password=DB_PASS
        )
    except psycopg2.Error as e:
        print(f"Database connection failed: {e}")
        return None

@app.on_event("startup")
def initialize_database():
    conn = get_db_connection()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(100),
                    message TEXT,
                    role VARCHAR(20),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_user_id ON chat_history(user_id);
            """)
            conn.commit()
    finally:
        conn.close()
    # Start Kafka consumer in background thread
    threading.Thread(target=document_consumer, daemon=True).start()

def save_message(user_id: str, message: str, role: str):
    """Save message to database and S3"""
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO chat_history (user_id, message, role) VALUES (%s, %s, %s)",
                    (user_id, message, role)
                )
            conn.commit()
        finally:
            conn.close()
    
    # Archive to S3
    timestamp = datetime.now().isoformat()
    s3_key = f"chats/{user_id}/{timestamp}_{role}.json"
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps({"user_id": user_id, "message": message, "role": role, "timestamp": timestamp})
        )
    except Exception as e:
        print(f"S3 Archival Error: {e}")

def get_conversation_context(user_id: str, limit: int = 10):
    """Retrieve recent conversation history for context"""
    conn = get_db_connection()
    if not conn:
        return []
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role, message FROM chat_history WHERE user_id = %s ORDER BY timestamp DESC LIMIT %s",
                (user_id, limit)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    
    # Reverse to get chronological order
    return [{"role": row[0], "message": row[1]} for row in reversed(rows)]

async def generate_streaming_response(user_id: str, message: str):
    """Generate streaming AI response using Gemini"""
    # Get conversation context
    context = get_conversation_context(user_id)
    
    # Build conversation history for Gemini
    chat_history = []
    for msg in context:
        if msg["role"] == "user":
            chat_history.append({"role": "user", "parts": [msg["message"]]})
        elif msg["role"] == "assistant":
            chat_history.append({"role": "model", "parts": [msg["message"]]})
    
    # System prompt for educational context
    system_prompt = """You are an intelligent educational assistant for a cloud-based learning platform. 
Your role is to help students learn by:
- Explaining complex topics in simple terms
- Providing examples and analogies
- Encouraging critical thinking
- Being patient and supportive
- Staying focused on educational topics

Keep responses concise and engaging."""
    
    if model:
        try:
            # Start chat with history
            chat = model.start_chat(history=chat_history)
            
            # Generate streaming response
            response = chat.send_message(message, stream=True)
            
            full_response = ""
            for chunk in response:
                if chunk.text:
                    full_response += chunk.text
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
            
            # Save assistant response
            save_message(user_id, full_response, "assistant")
            
            # Publish event
            send_event("chat.message", {
                "user_id": user_id,
                "user_message": message,
                "assistant_message": full_response,
                "timestamp": datetime.now().isoformat()
            })
            
            yield f"data: {json.dumps({'done': True})}\n\n"
            
        except Exception as e:
            print(f"Gemini API Error: {e}")
            error_msg = f"I apologize, but I encountered an error. Please try again. Error: {str(e)}"
            yield f"data: {json.dumps({'text': error_msg, 'done': True})}\n\n"
            save_message(user_id, error_msg, "assistant")
    else:
        # Fallback response if Gemini not configured
        fallback = "Chat service is not fully configured. Please add your GEMINI_API_KEY to the .env file."
        yield f"data: {json.dumps({'text': fallback, 'done': True})}\n\n"
        save_message(user_id, fallback, "assistant")

@app.post("/api/chat/message")
async def send_message(request: ChatRequest):
    """
    Send a message and get AI response (streaming or non-streaming)
    """
    # Save user message
    save_message(request.user_id, request.message, "user")
    
    if request.stream:
        # Return streaming response
        return StreamingResponse(
            generate_streaming_response(request.user_id, request.message),
            media_type="text/event-stream"
        )
    else:
        # Non-streaming response (for compatibility)
        full_response = ""
        async for chunk in generate_streaming_response(request.user_id, request.message):
            if '"text"' in chunk:
                data = json.loads(chunk.replace("data: ", ""))
                if "text" in data:
                    full_response += data["text"]
        
        return {"response": full_response}

@app.get("/api/chat/conversations")
async def list_conversations(user_id: str):
    """List all conversations for a user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
        
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT user_id, MAX(timestamp) as last_active FROM chat_history WHERE user_id = %s GROUP BY user_id",
                (user_id,)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    
    return [{"user_id": row[0], "last_active": row[1].isoformat() if row[1] else None} for row in rows]

@app.get("/api/chat/conversations/{user_id}")
async def get_conversation_history(user_id: str, limit: int = 50):
    """Get conversation history for a specific user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
        
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT message, role, timestamp FROM chat_history WHERE user_id = %s ORDER BY timestamp ASC LIMIT %s",
                (user_id, limit)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    
    return [{"message": row[0], "role": row[1], "timestamp": row[2].isoformat() if row[2] else None} for row in rows]

@app.delete("/api/chat/conversations/{user_id}")
async def delete_conversation(user_id: str):
    """Delete all messages for a user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
        
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM chat_history WHERE user_id = %s", (user_id,))
        conn.commit()
    finally:
        conn.close()
    
    return {"status": "deleted"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    gemini_status = "configured" if model else "not_configured"
    return {
        "status": "healthy",
        "service": "chat-service",
        "gemini_ai": gemini_status,
        "database": "connected" if get_db_connection() else "disconnected"
    }

def document_consumer():
    """
    Background worker: Listens for document processed events
    to provide document-aware chat responses
    """
    try:
        consumer = create_consumer("document.processed", "chat_service_group")
        print("Kafka Consumer started: Listening for document events...")
        
        for message in consumer:
            try:
                data = message.value
                doc_id = data.get('id')
                content = data.get('content', '')
                print(f"Received document event: {doc_id}")
                # Store document context for future reference in chat
                # This could be used to answer questions about uploaded documents
            except Exception as e:
                print(f"Error processing Kafka message: {e}")
    except Exception as e:
        print(f"Kafka consumer error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)