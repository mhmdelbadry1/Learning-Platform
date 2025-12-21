import os
import json
import uuid
import threading
import boto3
import psycopg2
from datetime import datetime
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Dict
from dotenv import load_dotenv
import google.generativeai as genai
import sys

sys.path.append("..")
from common.kafka_consumer import create_consumer
from common.kafka_producer import send_event

load_dotenv()

app = FastAPI(title="Quiz and Exercise Service", version="1.0.0")

# --- Configuration ---
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET = os.getenv("QUIZ_BUCKET_NAME")
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
    print("WARNING: GEMINI_API_KEY not configured. Quiz generation will be limited.")

s3_client = boto3.client('s3', region_name=AWS_REGION)

# Pydantic models
class QuizGenerationRequest(BaseModel):
    document_id: str
    num_questions: int = 5
    question_types: List[str] = ["multiple_choice", "true_false"]

class QuizAnswer(BaseModel):
    question_id: int
    answer: str

class QuizSubmission(BaseModel):
    quiz_id: str
    user_id: str
    answers: List[QuizAnswer]

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
                CREATE TABLE IF NOT EXISTS quizzes (
                    id VARCHAR(50) PRIMARY KEY,
                    document_id VARCHAR(50),
                    title VARCHAR(255),
                    questions JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS quiz_responses (
                    id SERIAL PRIMARY KEY,
                    quiz_id VARCHAR(50) REFERENCES quizzes(id) ON DELETE CASCADE,
                    user_id VARCHAR(100),
                    answers JSONB,
                    score FLOAT,
                    feedback JSONB,
                    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_quiz_doc ON quizzes(document_id);
                CREATE INDEX IF NOT EXISTS idx_response_user ON quiz_responses(user_id);
            """)
            conn.commit()
    finally:
        conn.close()
    # Start Kafka consumer
    threading.Thread(target=document_notes_consumer, daemon=True).start()

def generate_quiz_with_ai(document_content: str, document_title: str, num_questions: int = 5, question_types: List[str] = None):
    """Generate quiz questions using Gemini AI"""
    if not model:
        return {
            "questions": [
                {
                    "id": 1,
                    "type": "multiple_choice",
                    "question": "AI not configured. Please add GEMINI_API_KEY.",
                    "options": ["A", "B", "C", "D"],
                    "correct_answer": "A",
                    "explanation": "Configuration required"
                }
            ]
        }
    
    if not question_types:
        question_types = ["multiple_choice", "true_false"]
    
    try:
        prompt = f"""You are an expert quiz generator. Create {num_questions} educational quiz questions based on the following document.

Document Title: {document_title}

Document Content:
{document_content[:10000]}

Requirements:
- Generate exactly {num_questions} questions
- Include these question types: {', '.join(question_types)}
- Each question should test understanding of key concepts
- Provide detailed explanations for correct answers
- Make the quiz challenging but fair

Format your response as a JSON array of questions with this structure:
{{
  "questions": [
    {{
      "id": 1,
      "type": "multiple_choice" or "true_false" or "short_answer",
      "question": "Question text here",
      "options": ["A", "B", "C", "D"] (for multiple choice only),
      "correct_answer": "B" or "true" or "Short answer text",
      "explanation": "Why this is correct and what makes other options wrong"
    }}
  ]
}}

IMPORTANT: Return ONLY valid JSON, no additional text."""

        response = model.generate_content(prompt)
        
        # Try to parse JSON
        try:
            # Remove markdown code blocks if present
            text = response.text.strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            
            quiz_data = json.loads(text)
            return quiz_data
        except json.JSONDecodeError as e:
            print(f"JSON parse error: {e}, Response: {response.text[:200]}")
            # Fallback: create basic quiz from response
            return {
                "questions": [
                    {
                        "id": 1,
                        "type": "short_answer",
                        "question": "What are the key concepts from this document?",
                        "correct_answer": "See document content",
                        "explanation": response.text[:500]
                    }
                ]
            }
    
    except Exception as e:
        print(f"Quiz generation error: {e}")
        return {
            "questions": [
                {
                    "id": 1,
                    "type": "multiple_choice",
                    "question": f"Quiz generation failed: {str(e)}",
                    "options": ["Error occurred"],
                    "correct_answer": "Error occurred",
                    "explanation": "Please try again"
                }
            ]
        }

def calculate_score_and_feedback(quiz_questions: List[Dict], user_answers: List[Dict]):
    """Calculate score and provide detailed feedback"""
    total_questions = len(quiz_questions)
    correct_count = 0
    feedback = []
    
    # Create answer lookup
    answer_map = {ans["question_id"]: ans["answer"] for ans in user_answers}
    
    for question in quiz_questions:
        q_id = question["id"]
        correct_answer = question["correct_answer"].lower().strip()
        user_answer = answer_map.get(q_id, "").lower().strip()
        
        is_correct = user_answer == correct_answer
        if is_correct:
            correct_count += 1
        
        feedback.append({
            "question_id": q_id,
            "question": question["question"],
            "user_answer": user_answer,
            "correct_answer": correct_answer,
            "is_correct": is_correct,
            "explanation": question.get("explanation", "")
        })
    
    score = (correct_count / total_questions) * 100 if total_questions > 0 else 0
    
    return {
        "score": round(score, 2),
        "correct_count": correct_count,
        "total_questions": total_questions,
        "feedback": feedback
    }

@app.post("/api/quiz/generate")
async def generate_quiz(request: QuizGenerationRequest, background_tasks: BackgroundTasks):
    """Generate a quiz from a document"""
    # Get document content from database
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            # Try to get document content from document service database
            cur.execute(
                "SELECT filename, content_preview FROM documents WHERE id = %s",
                (request.document_id,)
            )
            doc = cur.fetchone()
            
            if not doc:
                raise HTTPException(status_code=404, detail="Document not found")
            
            filename = doc[0]
            content = doc[1] or "No content available"
            
            # Also try to get notes for richer content
            cur.execute(
                "SELECT notes, summary FROM document_notes WHERE document_id = %s ORDER BY created_at DESC LIMIT 1",
                (request.document_id,)
            )
            notes_row = cur.fetchone()
            
            if notes_row:
                content = f"Summary: {notes_row[1]}\n\nNotes: {notes_row[0]}\n\nFull Content: {content}"
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    finally:
        conn.close()
    
    # Generate quiz with AI
    quiz_data = generate_quiz_with_ai(
        content,
        filename,
        request.num_questions,
        request.question_types
    )
    
    # Save quiz to database
    quiz_id = str(uuid.uuid4())
    conn = get_db_connection()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO quizzes (id, document_id, title, questions) 
                       VALUES (%s, %s, %s, %s)""",
                    (quiz_id, request.document_id, f"Quiz: {filename}", json.dumps(quiz_data["questions"]))
                )
            conn.commit()
        finally:
            conn.close()
    
    # Save to S3
    s3_key = f"quizzes/{quiz_id}.json"
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=json.dumps(quiz_data),
        ContentType='application/json'
    )
    
    # Publish event
    send_event("quiz.generated", {
        "quiz_id": quiz_id,
        "document_id": request.document_id,
        "num_questions": len(quiz_data["questions"]),
        "timestamp": datetime.now().isoformat()
    })
    
    return {
        "quiz_id": quiz_id,
        "title": f"Quiz: {filename}",
        "num_questions": len(quiz_data["questions"]),
        "status": "generated"
    }

@app.get("/api/quiz/{id}")
async def get_quiz(id: str):
    """Get quiz questions"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, title, questions, created_at FROM quizzes WHERE id = %s",
                (id,)
            )
            quiz = cur.fetchone()
    finally:
        conn.close()
    
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    
    # Parse questions - JSONB is already parsed by psycopg2
    questions = quiz[2] if isinstance(quiz[2], list) else json.loads(quiz[2])
    hidden_questions = [
        {k: v for k, v in q.items() if k not in ["correct_answer", "explanation"]}
        for q in questions
    ]
    
    return {
        "id": quiz[0],
        "title": quiz[1],
        "questions": hidden_questions,
        "created_at": quiz[3].isoformat() if quiz[3] else None
    }

@app.post("/api/quiz/{id}/submit")
async def submit_quiz(id: str, submission: QuizSubmission):
    """Submit quiz answers and get results"""
    # Get quiz questions
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT questions FROM quizzes WHERE id = %s", (id,))
            quiz = cur.fetchone()
            
            if not quiz:
                raise HTTPException(status_code=404, detail="Quiz not found")
            
            # JSONB is already parsed by psycopg2
            questions = quiz[0] if isinstance(quiz[0], list) else json.loads(quiz[0])
    
        # Calculate score and feedback
        results = calculate_score_and_feedback(
            questions,
            [ans.dict() for ans in submission.answers]
        )
        
        # Save response
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO quiz_responses (quiz_id, user_id, answers, score, feedback) 
                   VALUES (%s, %s, %s, %s, %s)""",
                (id, submission.user_id, json.dumps([ans.dict() for ans in submission.answers]),
                 results["score"], json.dumps(results["feedback"]))
            )
        conn.commit()
        
    finally:
        conn.close()
    
    return results

@app.get("/api/quiz/{id}/results")
async def get_quiz_results(id: str, user_id: str):
    """Get quiz results for a specific user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT score, feedback, submitted_at FROM quiz_responses 
                   WHERE quiz_id = %s AND user_id = %s ORDER BY submitted_at DESC LIMIT 1""",
                (id, user_id)
            )
            result = cur.fetchone()
    finally:
        conn.close()
    
    if not result:
        raise HTTPException(status_code=404, detail="No results found")
    
    return {
        "score": result[0],
        "feedback": json.loads(result[1]),
        "submitted_at": result[2].isoformat() if result[2] else None
    }

@app.get("/api/quiz/history")
async def get_quiz_history(user_id: str, limit: int = 20):
    """Get quiz history for a user"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT qr.quiz_id, q.title, qr.score, qr.submitted_at 
                   FROM quiz_responses qr
                   JOIN quizzes q ON qr.quiz_id = q.id
                   WHERE qr.user_id = %s 
                   ORDER BY qr.submitted_at DESC LIMIT %s""",
                (user_id, limit)
            )
            history = [
                {
                    "quiz_id": row[0],
                    "title": row[1],
                    "score": row[2],
                    "submitted_at": row[3].isoformat() if row[3] else None
                }
                for row in cur.fetchall()
            ]
    finally:
        conn.close()
    
    return history  # Return empty array if no results

@app.delete("/api/quiz/{id}")
async def delete_quiz(id: str):
    """Delete a quiz"""
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database unavailable")
    
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM quizzes WHERE id = %s", (id,))
        conn.commit()
        
        # Delete from S3
        try:
            s3_client.delete_object(Bucket=S3_BUCKET, Key=f"quizzes/{id}.json")
        except Exception as e:
            print(f"S3 deletion error: {e}")
    finally:
        conn.close()
    
    return {"status": "deleted"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    gemini_status = "configured" if model else "not_configured"
    return {
        "status": "healthy",
        "service": "quiz-service",
        "gemini_ai": gemini_status,
        "database": "connected" if get_db_connection() else "disconnected"
    }

def document_notes_consumer():
    """
    Background worker: Listens for document notes generated events
    to automatically suggest quiz generation
    """
    try:
        consumer = create_consumer("notes.generated", "quiz_service_group")
        print("Kafka Consumer started: Listening for document notes...")
        
        for message in consumer:
            try:
                data = message.value
                doc_id = data.get('document_id')
                print(f"Received notes for document: {doc_id}")
                # Could auto-generate quiz here if desired
            except Exception as e:
                print(f"Error processing Kafka message: {e}")
    except Exception as e:
        print(f"Kafka consumer error: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)