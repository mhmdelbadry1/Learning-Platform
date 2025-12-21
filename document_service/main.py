import os
import uuid
import json
import boto3
import psycopg2
import PyPDF2
import pdfplumber
from docx import Document as DocxDocument
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import Optional
import google.generativeai as genai
import io
import sys

sys.path.append("..")
from common.kafka_producer import send_event

load_dotenv()

app = FastAPI(title="Document Reader Service", version="1.0.0")

# --- Configuration ---
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET = os.getenv("DOCUMENT_BUCKET_NAME")
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
    print("WARNING: GEMINI_API_KEY not configured. Document summarization will be limited.")

s3_client = boto3.client('s3', region_name=AWS_REGION)

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
                CREATE TABLE IF NOT EXISTS documents (
                    id VARCHAR(50) PRIMARY KEY,
                    user_id VARCHAR(100),
                    filename VARCHAR(255),
                    file_type VARCHAR(20),
                    s3_url VARCHAR(500),
                    content_preview TEXT,
                    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed BOOLEAN DEFAULT FALSE
                );
                CREATE TABLE IF NOT EXISTS document_notes (
                    id SERIAL PRIMARY KEY,
                    document_id VARCHAR(50) REFERENCES documents(id) ON DELETE CASCADE,
                    notes TEXT,
                    summary TEXT,
                    key_points TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_doc_user ON documents(user_id);
            """)
            conn.commit()
    finally:
        conn.close()

def extract_text_from_pdf(file_bytes):
    """Extract text from PDF using multiple methods for best results"""
    text = ""
    try:
        # Method 1: pdfplumber (better for complex PDFs)
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n\n"
    except Exception as e:
        print(f"pdfplumber failed: {e}, trying PyPDF2...")
        try:
            # Method 2: PyPDF2 (fallback)
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n\n"
        except Exception as e2:
            print(f"PyPDF2 also failed: {e2}")
            raise HTTPException(status_code=400, detail="Could not extract text from PDF")
    
    return text.strip()

def extract_text_from_docx(file_bytes):
    """Extract text from DOCX file"""
    try:
        doc = DocxDocument(io.BytesIO(file_bytes))
        text = "\n\n".join([paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip()])
        return text.strip()
    except Exception as e:
        print(f"DOCX extraction failed: {e}")
        raise HTTPException(status_code=400, detail="Could not extract text from DOCX")

def extract_text_from_txt(file_bytes):
    """Extract text from TXT file"""
    try:
        return file_bytes.decode('utf-8', errors='ignore').strip()
    except Exception as e:
        print(f"TXT extraction failed: {e}")
        raise HTTPException(status_code=400, detail="Could not read text file")

def generate_notes_with_ai(content: str, filename: str):
    """Generate comprehensive notes using Gemini AI"""
    if not model:
        return {
            "summary": "AI summarization not available. Please configure GEMINI_API_KEY.",
            "notes": content[:500] + "..." if len(content) > 500 else content,
            "key_points": ["Configuration required"]
        }
    
    try:
        # Create a comprehensive prompt for note generation
        prompt = f"""You are an expert educational assistant. Analyze the following document and create detailed study notes.

Document Title: {filename}

Document Content:
{content[:15000]}  # Limit content to avoid token limits

Please provide:
1. A concise summary (2-3 sentences)
2. Comprehensive study notes organized by topics
3. Key points and takeaways (bullet points)

Format your response as JSON with keys: "summary", "notes", "key_points" (array of strings)"""

        response = model.generate_content(prompt)
        
        # Try to parse as JSON first
        try:
            result = json.loads(response.text)
        except:
            # Fallback: create structured response from text
            result = {
                "summary": response.text[:300].split('\n')[0],
                "notes": response.text,
                "key_points": [line.strip() for line in response.text.split('\n') if line.strip().startswith('-') or line.strip().startswith('•')][:10]
            }
        
        return result
    
    except Exception as e:
        print(f"AI note generation error: {e}")
        # Fallback to basic extraction
        lines = content.split('\n')
        return {
            "summary": f"Document contains {len(lines)} lines of text. AI summarization failed: {str(e)}",
            "notes": content[:1000] + "..." if len(content) > 1000 else content,
            "key_points": [line.strip() for line in lines if len(line.strip()) > 20][:5]
        }

def process_document_async(doc_id: str, file_bytes: bytes, filename: str, file_type: str):
    """Background task to process document and generate notes"""
    try:
        # Extract text based on file type
        if file_type == 'pdf':
            content = extract_text_from_pdf(file_bytes)
        elif file_type in ['docx', 'doc']:
            content = extract_text_from_docx(file_bytes)
        elif file_type == 'txt':
            content = extract_text_from_txt(file_bytes)
        else:
            content = "Unsupported file type"
        
        # Generate AI notes
        ai_notes = generate_notes_with_ai(content, filename)
        
        # Save notes to database
        conn = get_db_connection()
        if conn:
            try:
                with conn.cursor() as cur:
                    # Update document as processed
                    cur.execute(
                        "UPDATE documents SET processed = TRUE, content_preview = %s WHERE id = %s",
                        (content[:500], doc_id)
                    )
                    # Insert notes
                    cur.execute(
                        """INSERT INTO document_notes (document_id, notes, summary, key_points) 
                           VALUES (%s, %s, %s, %s)""",
                        (doc_id, ai_notes.get('notes', ''), ai_notes.get('summary', ''), 
                         json.dumps(ai_notes.get('key_points', [])))
                    )
                conn.commit()
            finally:
                conn.close()
        
        # Save notes to S3
        notes_key = f"notes/{doc_id}_notes.json"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=notes_key,
            Body=json.dumps(ai_notes),
            ContentType='application/json'
        )
        
        # Publish Kafka event
        send_event("document.processed", {
            "id": doc_id,
            "filename": filename,
            "content": content[:1000],  # Send preview to other services
            "summary": ai_notes.get('summary', ''),
            "processed_at": str(uuid.uuid4())
        })
        
        send_event("notes.generated", {
            "document_id": doc_id,
            "notes": ai_notes,
            "timestamp": str(uuid.uuid4())
        })
        
        print(f"Document {doc_id} processed successfully")
        
    except Exception as e:
        print(f"Error processing document {doc_id}: {e}")
        # Update document with error status
        conn = get_db_connection()
        if conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE documents SET processed = FALSE, content_preview = %s WHERE id = %s",
                        (f"Error: {str(e)}", doc_id)
                    )
                conn.commit()
            finally:
                conn.close()

@app.post("/api/documents/upload")
async def upload_document(background_tasks: BackgroundTasks, file: UploadFile = File(...), user_id: str = Form("default")):
    """Upload and process a document"""
    doc_id = str(uuid.uuid4())
    
    # Validate file type
    filename = file.filename.lower()
    if filename.endswith('.pdf'):
        file_type = 'pdf'
    elif filename.endswith('.docx') or filename.endswith('.doc'):
        file_type = 'docx'
    elif filename.endswith('.txt'):
        file_type = 'txt'
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload PDF, DOCX, or TXT files.")
    
    try:
        # Read file content
        file_bytes = await file.read()
        
        # Upload to S3
        file_key = f"documents/{doc_id}/{file.filename}"
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=file_key,
            Body=file_bytes,
            ContentType=file.content_type
        )
        s3_url = f"s3://{S3_BUCKET}/{file_key}"
        
        # Save to database
        conn = get_db_connection()
        if conn:
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """INSERT INTO documents (id, user_id, filename, file_type, s3_url, processed) 
                           VALUES (%s, %s, %s, %s, %s, %s)""",
                        (doc_id, user_id, file.filename, file_type, s3_url, False)
                    )
                conn.commit()
            finally:
                conn.close()
        
        # Process document in background
        background_tasks.add_task(process_document_async, doc_id, file_bytes, file.filename, file_type)
        
        return {
            "id": doc_id,
            "filename": file.filename,
            "status": "uploaded",
            "message": "Document is being processed. Notes will be available shortly."
        }
    
    except Exception as e:
        print(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents/{id}")
async def get_document(id: str):
    """Get document details"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, filename, file_type, s3_url, content_preview, uploaded_at, processed FROM documents WHERE id = %s",
                (id,)
            )
            doc = cur.fetchone()
    finally:
        conn.close()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "id": doc[0],
        "filename": doc[1],
        "file_type": doc[2],
        "s3_url": doc[3],
        "content_preview": doc[4],
        "uploaded_at": doc[5].isoformat() if doc[5] else None,
        "processed": doc[6]
    }

@app.get("/api/documents/{id}/notes")
async def get_document_notes(id: str):
    """Get AI-generated notes for a document"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT notes, summary, key_points, created_at FROM document_notes WHERE document_id = %s ORDER BY created_at DESC LIMIT 1",
                (id,)
            )
            notes = cur.fetchone()
    finally:
        conn.close()
    
    if not notes:
        return {"notes": None, "message": "Notes not yet generated. Please wait or try regenerating."}
    
    return {
        "notes": notes[0],
        "summary": notes[1],
        "key_points": json.loads(notes[2]) if notes[2] else [],
        "created_at": notes[3].isoformat() if notes[3] else None
    }

@app.post("/api/documents/{id}/regenerate-notes")
async def regenerate_notes(id: str, background_tasks: BackgroundTasks):
    """Regenerate notes for a document"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    # Get document from S3
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT s3_url, filename, file_type FROM documents WHERE id = %s", (id,))
            doc = cur.fetchone()
        
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Download from S3
        s3_url = doc[0]
        key = s3_url.replace(f"s3://{S3_BUCKET}/", "")
        response = s3_client.get_object(Bucket=S3_BUCKET, Key=key)
        file_bytes = response['Body'].read()
        
        # Process in background
        background_tasks.add_task(process_document_async, id, file_bytes, doc[1], doc[2])
        
        return {"status": "regeneration_started", "message": "Notes are being regenerated"}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if conn:
            conn.close()

@app.get("/api/documents")
async def list_documents(user_id: str = "default", limit: int = 50):
    """List all documents for a user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, filename, file_type, uploaded_at, processed FROM documents WHERE user_id = %s ORDER BY uploaded_at DESC LIMIT %s",
                (user_id, limit)
            )
            docs = [
                {
                    "id": row[0],
                    "filename": row[1],
                    "file_type": row[2],
                    "uploaded_at": row[3].isoformat() if row[3] else None,
                    "processed": row[4]
                }
                for row in cur.fetchall()
            ]
    finally:
        conn.close()
    
    return docs

@app.delete("/api/documents/{id}")
async def delete_document(id: str):
    """Delete a document and its notes"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            # Get S3 URL first
            cur.execute("SELECT s3_url FROM documents WHERE id = %s", (id,))
            row = cur.fetchone()
            
            if row:
                # Delete from S3
                try:
                    s3_url = row[0]
                    key = s3_url.replace(f"s3://{S3_BUCKET}/", "")
                    s3_client.delete_object(Bucket=S3_BUCKET, Key=key)
                    # Delete notes from S3
                    s3_client.delete_object(Bucket=S3_BUCKET, Key=f"notes/{id}_notes.json")
                except Exception as e:
                    print(f"S3 deletion error: {e}")
            
            # Delete from database (cascade will delete notes)
            cur.execute("DELETE FROM documents WHERE id = %s", (id,))
        
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
        "service": "document-service",
        "gemini_ai": gemini_status,
        "database": "connected" if get_db_connection() else "disconnected"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
