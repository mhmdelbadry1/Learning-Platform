import os
import logging
from datetime import datetime
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional

from database import get_db_connection, init_db
from schemas import UserRegister, UserLogin, Token, UserResponse
from auth import hash_password, verify_password, create_access_token, decode_token

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("auth_service")

app = FastAPI(title="Auth Service", version="1.0.0")

#  CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database on startup
@app.on_event("startup")
async def startup():
    try:
        init_db()
        logger.info("Auth service started successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        logger.warning("Service started but database may not be ready")

@app.get("/")
async def root():
    return {"service": "auth", "status": "healthy"}

@app.post("/api/auth/register", response_model=Token)
async def register(user: UserRegister):
    """Register a new user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Check if user already exists
        cursor.execute("SELECT id FROM users WHERE email = %s OR username = %s", 
                      (user.email, user.username))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="User already exists")
        
        # Hash password
        password_hash = hash_password(user.password)
        
        # Create user
        cursor.execute("""
            INSERT INTO users (username, email, password_hash)
            VALUES (%s, %s, %s)
            RETURNING id, username, email
        """, (user.username, user.email, password_hash))
        
        new_user = cursor.fetchone()
        conn.commit()
        
        # Create JWT token
        token = create_access_token({
            "user_id": new_user["id"],
            "username": new_user["username"],
            "email": new_user["email"]
        })
        
        logger.info(f"New user registered: {user.username}")
        
        return Token(
            token=token,
            user_id=new_user["id"],
            username=new_user["username"],
            email=new_user["email"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        logger.error(f"Registration error: {e}")
        raise HTTPException(status_code=500, detail="Registration failed")
    finally:
        cursor.close()
        conn.close()

@app.post("/api/auth/login", response_model=Token)
async def login(credentials: UserLogin):
    """Login user"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Get user
        cursor.execute("""
            SELECT id, username, email, password_hash, is_active
            FROM users WHERE email = %s
        """, (credentials.email,))
        
        user = cursor.fetchone()
        
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        if not user["is_active"]:
            raise HTTPException(status_code=403, detail="Account disabled")
        
        # Verify password
        if not verify_password(credentials.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Update last login
        cursor.execute("""
            UPDATE users SET last_login = %s WHERE id = %s
        """, (datetime.utcnow(), user["id"]))
        conn.commit()
        
        # Create JWT token
        token = create_access_token({
            "user_id": user["id"],
            "username": user["username"],
            "email": user["email"]
        })
        
        logger.info(f"User logged in: {user['username']}")
        
        return Token(
            token=token,
            user_id=user["id"],
            username=user["username"],
            email=user["email"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Login failed")
    finally:
        cursor.close()
        conn.close()

@app.get("/api/auth/me", response_model=UserResponse)
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user from JWT token"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    try:
        token = authorization.replace("Bearer ", "")
        payload = decode_token(token)
        
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT id, username, email, created_at, is_active
            FROM users WHERE id = %s
        """, (payload["user_id"],))
        
        user = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return UserResponse(
            id=user["id"],
            username=user["username"],
            email=user["email"],
            created_at=str(user["created_at"]),
            is_active=user["is_active"]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user error: {e}")
        raise HTTPException(status_code=401, detail="Invalid token")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
