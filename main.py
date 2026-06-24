from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import sqlite3
import os

app = FastAPI(title="Task Scheduler API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = os.path.join(os.path.dirname(__file__), "tasks.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT CHECK(priority IN ('low','medium','high')) DEFAULT 'medium',
            status TEXT CHECK(status IN ('pending','in_progress','completed')) DEFAULT 'pending',
            due_date TEXT,
            category TEXT DEFAULT 'General',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()


init_db()


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: Optional[str] = "medium"
    status: Optional[str] = "pending"
    due_date: Optional[str] = None
    category: Optional[str] = "General"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None
    category: Optional[str] = None


def row_to_dict(row):
    return dict(row) if row else None


@app.get("/")
def root():
    return {"message": "Task Scheduler API is running"}


@app.get("/tasks", response_model=List[dict])
def get_tasks(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    category: Optional[str] = None,
    search: Optional[str] = None
):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT * FROM tasks WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if priority:
        query += " AND priority = ?"
        params.append(priority)
    if category:
        query += " AND category = ?"
        params.append(category)
    if search:
        query += " AND (title LIKE ? OR description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY created_at DESC"
    cursor.execute(query, params)
    tasks = [row_to_dict(row) for row in cursor.fetchall()]
    conn.close()
    return tasks


@app.get("/tasks/{task_id}")
def get_task(task_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    task = row_to_dict(cursor.fetchone())
    conn.close()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.post("/tasks", status_code=201)
def create_task(task: TaskCreate):
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO tasks (title, description, priority, status, due_date, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (task.title, task.description, task.priority, task.status,
          task.due_date, task.category, now, now))
    conn.commit()
    task_id = cursor.lastrowid
    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    new_task = row_to_dict(cursor.fetchone())
    conn.close()
    return new_task


@app.put("/tasks/{task_id}")
def update_task(task_id: int, task: TaskUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    updates = {k: v for k, v in task.model_dump().items() if v is not None}
    if not updates:
        conn.close()
        return row_to_dict(existing)
    updates["updated_at"] = datetime.now().isoformat()
    set_clause = ", ".join([f"{k} = ?" for k in updates.keys()])
    values = list(updates.values()) + [task_id]
    cursor.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", values)
    conn.commit()
    cursor.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
    updated = row_to_dict(cursor.fetchone())
    conn.close()
    return updated


@app.delete("/tasks/{task_id}")
def delete_task(task_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM tasks WHERE id = ?", (task_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Task not found")
    cursor.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    conn.close()
    return {"message": "Task deleted successfully", "id": task_id}


@app.get("/stats")
def get_stats():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as total FROM tasks")
    total = cursor.fetchone()["total"]
    cursor.execute("SELECT status, COUNT(*) as count FROM tasks GROUP BY status")
    by_status = {row["status"]: row["count"] for row in cursor.fetchall()}
    cursor.execute("SELECT priority, COUNT(*) as count FROM tasks GROUP BY priority")
    by_priority = {row["priority"]: row["count"] for row in cursor.fetchall()}
    cursor.execute("SELECT category, COUNT(*) as count FROM tasks GROUP BY category ORDER BY count DESC LIMIT 5")
    by_category = {row["category"]: row["count"] for row in cursor.fetchall()}
    conn.close()
    return {
        "total": total,
        "by_status": by_status,
        "by_priority": by_priority,
        "by_category": by_category
    }


@app.get("/categories")
def get_categories():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT category FROM tasks ORDER BY category")
    categories = [row["category"] for row in cursor.fetchall()]
    conn.close()
    return categories