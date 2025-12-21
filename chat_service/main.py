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
    conversation_id: str  # Now required
    message: str
    stream: bool = True

class NewConversationRequest(BaseModel):
    user_id: str
    title: str = "New Conversation"

class UpdateTitleRequest(BaseModel):
    title: str

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
            # Create conversations table
            cur.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    user_id VARCHAR(100) NOT NULL,
                    title VARCHAR(255) DEFAULT 'New Conversation',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    is_archived BOOLEAN DEFAULT FALSE
                );
                CREATE INDEX IF NOT EXISTS idx_conv_user_id ON conversations(user_id);
            """)
            
            # Create chat_history table with conversation_id
            cur.execute("""
                CREATE TABLE IF NOT EXISTS chat_history (
                    id SERIAL PRIMARY KEY,
                    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
                    user_id VARCHAR(100),
                    message TEXT,
                    role VARCHAR(20),
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_user_id ON chat_history(user_id);
                CREATE INDEX IF NOT EXISTS idx_chat_conversation_id ON chat_history(conversation_id);
            """)
            conn.commit()
    finally:
        conn.close()
    # Start Kafka consumer in background thread
    threading.Thread(target=document_consumer, daemon=True).start()

def save_message(conversation_id: str, user_id: str, message: str, role: str):
    """Save message to database and S3"""
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO chat_history (conversation_id, user_id, message, role) VALUES (%s, %s, %s, %s)",
                    (conversation_id, user_id, message, role)
                )
                # Update conversation's updated_at timestamp
                cur.execute(
                    "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                    (conversation_id,)
                )
            conn.commit()
        finally:
            conn.close()
    
    # Archive to S3
    timestamp = datetime.now().isoformat()
    s3_key = f"chats/{user_id}/{conversation_id}/{timestamp}_{role}.json"
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=json.dumps({"conversation_id": conversation_id, "user_id": user_id, "message": message, "role": role, "timestamp": timestamp})
        )
    except Exception as e:
        print(f"S3 Archival Error: {e}")

def get_conversation_context(conversation_id: str, limit: int = 50):
    """Retrieve recent conversation history for context"""
    conn = get_db_connection()
    if not conn:
        return []
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT role, message FROM chat_history WHERE conversation_id = %s ORDER BY timestamp DESC LIMIT %s",
                (conversation_id, limit)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    
    # Reverse to get chronological order
    return [{"role": row[0], "message": row[1]} for row in reversed(rows)]

async def generate_streaming_response(conversation_id: str, user_id: str, message: str):
    """Generate streaming AI response using Gemini"""
    # Get conversation context (last 50 messages from this conversation)
    context = get_conversation_context(conversation_id)
    
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
            save_message(conversation_id, user_id, full_response, "assistant")
            
            # Publish event
            send_event("chat.message", {
                "conversation_id": conversation_id,
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
            save_message(conversation_id, user_id, error_msg, "assistant")
    else:
        # Fallback response if Gemini not configured
        fallback = "Chat service is not fully configured. Please add your GEMINI_API_KEY to the .env file."
        yield f"data: {json.dumps({'text': fallback, 'done': True})}\n\n"
        save_message(conversation_id, user_id, fallback, "assistant")

@app.post("/api/chat/message")
async def send_message(request: ChatRequest):
    """
    Send a message and get AI response (streaming or non-streaming)
    """
    # Save user message
    save_message(request.conversation_id, request.user_id, request.message, "user")
    
    if request.stream:
        # Return streaming response
        return StreamingResponse(
            generate_streaming_response(request.conversation_id, request.user_id, request.message),
            media_type="text/event-stream"
        )
    else:
        # Non-streaming response (for compatibility)
        full_response = ""
        async for chunk in generate_streaming_response(request.conversation_id, request.user_id, request.message):
            if '"text"' in chunk:
                data = json.loads(chunk.replace("data: ", ""))
                if "text" in data:
                    full_response += data["text"]
        
        return {"response": full_response}

# ===== New Conversation Management Endpoints =====

@app.post("/api/chat/conversations/new")
async def create_conversation(request: NewConversationRequest):
    """Create a new conversation"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO conversations (user_id, title) VALUES (%s, %s) RETURNING id, title, created_at",
                (request.user_id, request.title)
            )
            result = cur.fetchone()
        conn.commit()
    finally:
        conn.close()
    
    return {
        "id": str(result[0]),
        "title": result[1],
        "created_at": result[2].isoformat() if result[2] else None
    }

@app.get("/api/chat/conversations/list")
async def list_user_conversations(user_id: str):
    """Get all conversations for a user with preview of last message"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT 
                    c.id, 
                    c.title, 
                    c.updated_at,
                    c.created_at,
                    (SELECT message FROM chat_history WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM chat_history WHERE conversation_id = c.id) as message_count
                FROM conversations c
                WHERE c.user_id = %s AND c.is_archived = FALSE
                ORDER BY c.updated_at DESC
            """, (user_id,))
            rows = cur.fetchall()
    finally:
        conn.close()
    
    return [{
        "id": str(row[0]),
        "title": row[1],
        "last_active": row[2].isoformat() if row[2] else None,
        "created_at": row[3].isoformat() if row[3] else None,
        "last_message": row[4] if row[4] else "",
        "message_count": row[5]
    } for row in rows]

@app.get("/api/chat/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str, limit: int = 100):
    """Get messages for a specific conversation"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            # Get conversation info
            cur.execute(
                "SELECT title FROM conversations WHERE id = %s",
                (conversation_id,)
            )
            conv = cur.fetchone()
            if not conv:
                raise HTTPException(status_code=404, detail="Conversation not found")
            
            # Get messages
            cur.execute(
                "SELECT id, message, role, timestamp FROM chat_history WHERE conversation_id = %s ORDER BY timestamp ASC LIMIT %s",
                (conversation_id, limit)
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    
    return {
        "conversation_id": conversation_id,
        "title": conv[0],
        "messages": [{
            "id": row[0],
            "message": row[1],
            "role": row[2],
            "timestamp": row[3].isoformat() if row[3] else None
        } for row in rows]
    }

@app.patch("/api/chat/conversations/{conversation_id}/title")
async def update_conversation_title(conversation_id: str, request: UpdateTitleRequest):
    """Update conversation title"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE conversations SET title = %s, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
                (request.title, conversation_id)
            )
        conn.commit()
    finally:
        conn.close()
    
    return {"status": "updated", "title": request.title}

@app.delete("/api/chat/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a specific conversation and all its messages"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            # Delete conversation (messages will cascade delete due to foreign key)
            cur.execute("DELETE FROM conversations WHERE id = %s", (conversation_id,))
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