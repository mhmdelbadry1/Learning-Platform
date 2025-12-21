import os
from datetime import datetime, timedelta
from passlib.context import CryptContext
from jose import JWTError, jwt

# Security configuration
JWT_SECRET = os.getenv("JWT_SECRET", "your-secret-key-change-in-production-min-32-chars")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_MINUTES = 30

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    # Bcrypt has a 72 byte limit - truncate if needed
    password_bytes = password.encode('utf-8')[:72]
    return pwd_context.hash(password_bytes.decode('utf-8'))

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    """Create JWT access token"""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRY_MINUTES)
    to_encode.update({
        "exp": expire,
        "iss": "platform-jwt-issuer"  # Required by Kong JWT plugin
    })
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> dict:
    """Decode and verify JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        return None
