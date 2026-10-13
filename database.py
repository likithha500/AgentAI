import sqlite3
import json
import uuid
from datetime import datetime, timezone, timedelta
import os

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_history.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Sessions table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            model TEXT DEFAULT 'openai/gpt-oss-120b',
            system_prompt TEXT DEFAULT ''
        )
    """)
    
    # Messages table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            attachments TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
    """)
    
    # Indexes for high-speed queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC);")
    
    conn.commit()
    conn.close()

def create_session(title="New Chat", model="openai/gpt-oss-120b", system_prompt=""):
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO sessions (id, title, created_at, updated_at, model, system_prompt) VALUES (?, ?, ?, ?, ?, ?)",
        (session_id, title, now, now, model, system_prompt or "")
    )
    conn.commit()
    conn.close()
    return get_session(session_id)

def get_session(session_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def list_sessions(search_query=None):
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if search_query:
        cursor.execute(
            """
            SELECT DISTINCT s.* FROM sessions s
            LEFT JOIN messages m ON s.id = m.session_id
            WHERE s.title LIKE ? OR m.content LIKE ?
            ORDER BY s.updated_at DESC
            """,
            (f"%{search_query}%", f"%{search_query}%")
        )
    else:
        cursor.execute("SELECT * FROM sessions ORDER BY updated_at DESC")
    
    rows = cursor.fetchall()
    conn.close()
    
    sessions = [dict(row) for row in rows]
    
    # Group sessions by date
    now = datetime.now(timezone.utc)
    today = now.date()
    yesterday = today - timedelta(days=1)
    seven_days_ago = today - timedelta(days=7)
    
    grouped = {
        "today": [],
        "yesterday": [],
        "previous_7_days": [],
        "older": []
    }
    
    for s in sessions:
        try:
            # Parse ISO or SQLite timestamp
            created_str = s.get("updated_at") or s.get("created_at")
            if "T" in created_str:
                dt = datetime.fromisoformat(created_str)
            else:
                dt = datetime.strptime(created_str, "%Y-%m-%d %H:%M:%S")
            s_date = dt.date()
            
            if s_date == today:
                grouped["today"].append(s)
            elif s_date == yesterday:
                grouped["yesterday"].append(s)
            elif s_date > seven_days_ago:
                grouped["previous_7_days"].append(s)
            else:
                grouped["older"].append(s)
        except Exception:
            grouped["older"].append(s)
            
    return {
        "all": sessions,
        "grouped": grouped
    }

def update_session_title(session_id, title):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
        (title, now, session_id)
    )
    conn.commit()
    conn.close()
    return get_session(session_id)

def update_session_model(session_id, model):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?",
        (model, now, session_id)
    )
    conn.commit()
    conn.close()
    return get_session(session_id)

def update_session_timestamp(session_id):
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
    conn.commit()
    conn.close()

def delete_session(session_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    conn.close()
    return True

def clear_all_sessions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions")
    cursor.execute("DELETE FROM messages")
    conn.commit()
    conn.close()
    return True

def add_message(session_id, role, content, attachments=None):
    message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    attachments_json = json.dumps(attachments or [])
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO messages (id, session_id, role, content, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (message_id, session_id, role, content, attachments_json, now)
    )
    # Also update session updated_at
    cursor.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now, session_id))
    conn.commit()
    conn.close()
    
    return {
        "id": message_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "attachments": attachments or [],
        "created_at": now
    }

def get_messages(session_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC", (session_id,))
    rows = cursor.fetchall()
    conn.close()
    
    messages = []
    for row in rows:
        msg = dict(row)
        try:
            msg["attachments"] = json.loads(msg.get("attachments") or "[]")
        except Exception:
            msg["attachments"] = []
        messages.append(msg)
    return messages

def delete_message(message_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE id = ?", (message_id,))
    conn.commit()
    conn.close()
    return True

# Initialize database when loaded
init_db()
