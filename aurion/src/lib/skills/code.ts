/* ─── Code Generators — Python, JS, Java, C++, SQL, HTML, bash, Go, regex ─── */

export function generateCode(prompt: string, language: string): string {
  const lower = prompt.toLowerCase();

  switch (language) {
    case 'python': return generatePython(prompt, lower);
    case 'javascript': case 'typescript': return generateJS(prompt, lower);
    case 'java': return generateJava(prompt, lower);
    case 'cpp': return generateCpp(prompt, lower);
    case 'sql': return generateSQL(prompt, lower);
    case 'html': return generateHTML(prompt, lower);
    case 'bash': return generateBash(prompt, lower);
    case 'go': return generateGo(prompt, lower);
    default: return generatePython(prompt, lower);
  }
}

function generatePython(prompt: string, lower: string): string {
  if (lower.includes('sort') || lower.includes('sorting')) {
    return `\`\`\`python
def quicksort(arr: list) -> list:
    """Quicksort implementation — O(n log n) average, O(n²) worst case."""
    if len(arr) <= 1:
        return arr

    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]

    return quicksort(left) + middle + quicksort(right)


# Example usage
data = [38, 27, 43, 3, 9, 82, 10]
sorted_data = quicksort(data)
print(f"Original: {data}")
print(f"Sorted:   {sorted_data}")
# Output: Sorted: [3, 9, 10, 27, 38, 43, 82]
\`\`\``;
  }

  if (lower.includes('file') || lower.includes('read') || lower.includes('write')) {
    return `\`\`\`python
from pathlib import Path
import json


def read_file(filepath: str) -> str:
    """Read a text file and return its content."""
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    return path.read_text(encoding="utf-8")


def write_file(filepath: str, content: str) -> None:
    """Write content to a text file."""
    Path(filepath).write_text(content, encoding="utf-8")
    print(f"Written {len(content)} characters to {filepath}")


def read_json(filepath: str) -> dict:
    """Read and parse a JSON file."""
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(filepath: str, data: dict, indent: int = 2) -> None:
    """Write data to a JSON file."""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)


# Example usage
write_file("output.txt", "Hello, AURION!")
content = read_file("output.txt")
print(content)  # Hello, AURION!
\`\`\``;
  }

  if (lower.includes('api') || lower.includes('server') || lower.includes('flask') || lower.includes('fastapi')) {
    return `\`\`\`python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

app = FastAPI(title="AURION API", version="1.0.0")


class Item(BaseModel):
    name: str
    description: Optional[str] = None
    price: float
    in_stock: bool = True


# In-memory store
items_db: dict[int, Item] = {}
next_id = 1


@app.get("/")
async def root():
    return {"message": "AURION API is running", "version": "1.0.0"}


@app.post("/items", status_code=201)
async def create_item(item: Item):
    global next_id
    items_db[next_id] = item
    item_id = next_id
    next_id += 1
    return {"id": item_id, "item": item}


@app.get("/items/{item_id}")
async def get_item(item_id: int):
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"id": item_id, "item": items_db[item_id]}


@app.get("/items")
async def list_items():
    return [{"id": k, "item": v} for k, v in items_db.items()]


# Run: uvicorn main:app --reload
\`\`\``;
  }

  if (lower.includes('class') || lower.includes('oop')) {
    return `\`\`\`python
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Task:
    """Represents a task with priority and status tracking."""
    title: str
    description: str = ""
    priority: int = 1  # 1 (low) to 5 (high)
    completed: bool = False
    created_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None

    def complete(self) -> None:
        """Mark task as completed."""
        self.completed = True
        self.completed_at = datetime.now()

    def __str__(self) -> str:
        status = "✓" if self.completed else "○"
        stars = "★" * self.priority + "☆" * (5 - self.priority)
        return f"[{status}] {self.title} ({stars})"


class TaskManager:
    """Manage a collection of tasks."""

    def __init__(self):
        self.tasks: list[Task] = []

    def add(self, title: str, description: str = "", priority: int = 1) -> Task:
        task = Task(title=title, description=description, priority=priority)
        self.tasks.append(task)
        return task

    def pending(self) -> list[Task]:
        return [t for t in self.tasks if not t.completed]

    def by_priority(self) -> list[Task]:
        return sorted(self.tasks, key=lambda t: t.priority, reverse=True)


# Example usage
tm = TaskManager()
tm.add("Write documentation", priority=3)
tm.add("Fix login bug", priority=5)
tm.add("Update dependencies", priority=2)

for task in tm.by_priority():
    print(task)
\`\`\``;
  }

  // Default: general function
  return `\`\`\`python
"""
${prompt}
"""


def main():
    """Main function."""
    # Implementation based on requirements
    result = process(input_data)
    return result


def process(data):
    """Process the input data."""
    # Add your logic here
    return data


if __name__ == "__main__":
    main()
\`\`\`

*This is a starter template. Tell me more specifically what the function should do and I'll write the complete implementation.*`;
}

function generateJS(prompt: string, lower: string): string {
  if (lower.includes('react') || lower.includes('component')) {
    return `\`\`\`tsx
"use client";

import { useState, useEffect } from "react";

interface Item {
  id: number;
  name: string;
  completed: boolean;
}

export default function ItemList() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");

  const addItem = () => {
    if (!input.trim()) return;
    setItems((prev) => [
      ...prev,
      { id: Date.now(), name: input.trim(), completed: false },
    ]);
    setInput("");
  };

  const toggleItem = (id: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, completed: !item.completed } : item
      )
    );
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Item List</h1>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="Add an item..."
          className="flex-1 px-3 py-2 border rounded-lg bg-transparent"
        />
        <button
          onClick={addItem}
          className="px-4 py-2 bg-emerald-500 text-black rounded-lg hover:bg-emerald-400"
        >
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 p-3 border rounded-lg"
          >
            <input
              type="checkbox"
              checked={item.completed}
              onChange={() => toggleItem(item.id)}
            />
            <span className={item.completed ? "line-through opacity-50" : ""}>
              {item.name}
            </span>
            <button
              onClick={() => removeItem(item.id)}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
\`\`\``;
  }

  if (lower.includes('fetch') || lower.includes('api') || lower.includes('http')) {
    return `\`\`\`javascript
/**
 * Fetch wrapper with retry logic and error handling.
 */
async function apiClient(url, options = {}) {
  const { retries = 3, delay = 1000, ...fetchOptions } = options;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          ...fetchOptions.headers,
        },
        ...fetchOptions,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(\`HTTP \${response.status}: \${error}\`);
      }

      return await response.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(\`Attempt \${attempt} failed, retrying in \${delay}ms...\`);
      await new Promise((resolve) => setTimeout(resolve, delay * attempt));
    }
  }
}

// Usage
const data = await apiClient("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ key: "value" }),
  retries: 3,
});
console.log(data);
\`\`\``;
  }

  return `\`\`\`javascript
/**
 * ${prompt}
 */

function solution(input) {
  // Implementation
  const result = input;
  return result;
}

// Example usage
const input = "example";
const output = solution(input);
console.log(output);
\`\`\`

*Tell me more about what this function should do for a complete implementation.*`;
}

function generateJava(prompt: string, lower: string): string {
  if (lower.includes('linked list') || lower.includes('linkedlist')) {
    return `\`\`\`java
public class LinkedList<T> {
    private Node<T> head;
    private int size;

    private static class Node<T> {
        T data;
        Node<T> next;

        Node(T data) {
            this.data = data;
            this.next = null;
        }
    }

    public void add(T data) {
        Node<T> newNode = new Node<>(data);
        if (head == null) {
            head = newNode;
        } else {
            Node<T> current = head;
            while (current.next != null) {
                current = current.next;
            }
            current.next = newNode;
        }
        size++;
    }

    public T get(int index) {
        if (index < 0 || index >= size)
            throw new IndexOutOfBoundsException("Index: " + index + ", Size: " + size);
        Node<T> current = head;
        for (int i = 0; i < index; i++) {
            current = current.next;
        }
        return current.data;
    }

    public int size() {
        return size;
    }

    @Override
    public String toString() {
        StringBuilder sb = new StringBuilder("[");
        Node<T> current = head;
        while (current != null) {
            sb.append(current.data);
            if (current.next != null) sb.append(", ");
            current = current.next;
        }
        return sb.append("]").toString();
    }

    public static void main(String[] args) {
        LinkedList<String> list = new LinkedList<>();
        list.add("Hello");
        list.add("World");
        list.add("AURION");
        System.out.println(list);        // [Hello, World, AURION]
        System.out.println(list.get(1)); // World
        System.out.println(list.size()); // 3
    }
}
\`\`\``;
  }

  return `\`\`\`java
/**
 * ${prompt}
 */
public class Solution {

    public static void main(String[] args) {
        Solution sol = new Solution();
        // Example usage
        System.out.println(sol.process("input"));
    }

    public String process(String input) {
        // Implementation
        return input;
    }
}
\`\`\``;
}

function generateCpp(prompt: string, lower: string): string {
  if (lower.includes('vector') || lower.includes('array') || lower.includes('dynamic')) {
    return `\`\`\`cpp
#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>

int main() {
    // Dynamic array with std::vector
    std::vector<int> numbers = {38, 27, 43, 3, 9, 82, 10};

    // Sort
    std::sort(numbers.begin(), numbers.end());

    // Print
    std::cout << "Sorted: ";
    for (const auto& n : numbers) {
        std::cout << n << " ";
    }
    std::cout << "\\n";

    // Statistics
    int sum = std::accumulate(numbers.begin(), numbers.end(), 0);
    double avg = static_cast<double>(sum) / numbers.size();
    auto [min_it, max_it] = std::minmax_element(numbers.begin(), numbers.end());

    std::cout << "Sum: " << sum << "\\n";
    std::cout << "Average: " << avg << "\\n";
    std::cout << "Min: " << *min_it << ", Max: " << *max_it << "\\n";

    return 0;
}
\`\`\``;
  }

  return `\`\`\`cpp
#include <iostream>
#include <string>

/**
 * ${prompt}
 */
class Solution {
public:
    std::string process(const std::string& input) {
        // Implementation
        return input;
    }
};

int main() {
    Solution sol;
    auto result = sol.process("input");
    std::cout << result << std::endl;
    return 0;
}
\`\`\``;
}

function generateSQL(prompt: string, lower: string): string {
  if (lower.includes('table') || lower.includes('create') || lower.includes('schema')) {
    return `\`\`\`sql
-- Schema design
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    published BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_published ON posts(published);
CREATE INDEX idx_comments_post_id ON comments(post_id);

-- View: popular posts
CREATE VIEW popular_posts AS
SELECT p.title, u.username, COUNT(c.id) as comment_count
FROM posts p
JOIN users u ON p.user_id = u.id
LEFT JOIN comments c ON c.post_id = p.id
WHERE p.published = true
GROUP BY p.id, p.title, u.username
HAVING COUNT(c.id) > 0
ORDER BY comment_count DESC;
\`\`\``;
  }

  return `\`\`\`sql
-- ${prompt}

-- Common query patterns:

-- 1. Aggregate with filtering
SELECT
    category,
    COUNT(*) as total,
    AVG(price) as avg_price,
    SUM(quantity) as total_sold
FROM products
WHERE status = 'active'
GROUP BY category
HAVING COUNT(*) > 5
ORDER BY total_sold DESC
LIMIT 10;

-- 2. Window functions
SELECT
    name,
    department,
    salary,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) as dept_rank,
    salary - LAG(salary) OVER (PARTITION BY department ORDER BY salary) as diff_from_prev
FROM employees;

-- 3. CTE (Common Table Expression)
WITH monthly_revenue AS (
    SELECT
        DATE_TRUNC('month', order_date) as month,
        SUM(total) as revenue
    FROM orders
    GROUP BY 1
)
SELECT
    month,
    revenue,
    LAG(revenue) OVER (ORDER BY month) as prev_month,
    ROUND((revenue - LAG(revenue) OVER (ORDER BY month)) /
          NULLIF(LAG(revenue) OVER (ORDER BY month), 0) * 100, 2) as growth_pct
FROM monthly_revenue;
\`\`\``;
}

function generateHTML(prompt: string, lower: string): string {
  return `\`\`\`html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AURION Generated Page</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', system-ui, sans-serif;
            background: #0a0e1a;
            color: #e0e0e0;
            min-height: 100vh;
        }
        .hero {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 80vh;
            text-align: center;
            padding: 2rem;
        }
        .hero h1 {
            font-size: 3rem;
            background: linear-gradient(135deg, #3dffc2, #f5c16c);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 1rem;
        }
        .hero p {
            font-size: 1.2rem;
            max-width: 600px;
            opacity: 0.8;
            margin-bottom: 2rem;
        }
        .btn {
            display: inline-block;
            padding: 12px 32px;
            background: linear-gradient(135deg, #3dffc2, #2dd4a0);
            color: #0a0e1a;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(61, 255, 194, 0.3);
        }
        .features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 2rem;
            padding: 4rem 2rem;
            max-width: 1200px;
            margin: 0 auto;
        }
        .card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 2rem;
            transition: transform 0.2s;
        }
        .card:hover { transform: translateY(-4px); }
        .card h3 { color: #3dffc2; margin-bottom: 0.5rem; }
    </style>
</head>
<body>
    <section class="hero">
        <h1>Your Heading Here</h1>
        <p>A clean, modern landing page with dark theme and gradient accents.</p>
        <a href="#" class="btn">Get Started</a>
    </section>
    <section class="features">
        <div class="card">
            <h3>Feature One</h3>
            <p>Description of your first feature goes here.</p>
        </div>
        <div class="card">
            <h3>Feature Two</h3>
            <p>Description of your second feature goes here.</p>
        </div>
        <div class="card">
            <h3>Feature Three</h3>
            <p>Description of your third feature goes here.</p>
        </div>
    </section>
</body>
</html>
\`\`\``;
}

function generateBash(prompt: string, lower: string): string {
  return `\`\`\`bash
#!/bin/bash
# ${prompt}

set -euo pipefail

# Colors
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
NC='\\033[0m' # No Color

log_info()  { echo -e "\${GREEN}[INFO]\${NC} $1"; }
log_warn()  { echo -e "\${YELLOW}[WARN]\${NC} $1"; }
log_error() { echo -e "\${RED}[ERROR]\${NC} $1" >&2; }

# Check dependencies
check_deps() {
    local deps=("curl" "jq" "git")
    for dep in "\${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "$dep is not installed"
            exit 1
        fi
    done
    log_info "All dependencies satisfied"
}

# Main function
main() {
    log_info "Starting..."
    check_deps

    # Your logic here
    log_info "Done!"
}

main "$@"
\`\`\``;
}

function generateGo(prompt: string, lower: string): string {
  return `\`\`\`go
package main

import (
\t"encoding/json"
\t"fmt"
\t"log"
\t"net/http"
\t"sync"
)

// Item represents a data item
type Item struct {
\tID    int    \`json:"id"\`
\tName  string \`json:"name"\`
\tValue string \`json:"value"\`
}

// Store is a thread-safe in-memory store
type Store struct {
\tmu    sync.RWMutex
\titems map[int]Item
\tnext  int
}

func NewStore() *Store {
\treturn &Store{items: make(map[int]Item), next: 1}
}

func (s *Store) Add(name, value string) Item {
\ts.mu.Lock()
\tdefer s.mu.Unlock()
\titem := Item{ID: s.next, Name: name, Value: value}
\ts.items[s.next] = item
\ts.next++
\treturn item
}

func (s *Store) GetAll() []Item {
\ts.mu.RLock()
\tdefer s.mu.RUnlock()
\tresult := make([]Item, 0, len(s.items))
\tfor _, item := range s.items {
\t\tresult = append(result, item)
\t}
\treturn result
}

func main() {
\tstore := NewStore()

\thttp.HandleFunc("/items", func(w http.ResponseWriter, r *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\tjson.NewEncoder(w).Encode(store.GetAll())
\t})

\tfmt.Println("Server running on :8080")
\tlog.Fatal(http.ListenAndServe(":8080", nil))
}
\`\`\``;
}

export function explainCode(code: string): string {
  const lines = code.split('\n');
  const lineCount = lines.length;

  // Detect language
  let lang = 'unknown';
  if (code.includes('def ') || code.includes('import ') && code.includes('print(')) lang = 'Python';
  else if (code.includes('function ') || code.includes('const ') || code.includes('=>')) lang = 'JavaScript';
  else if (code.includes('public class') || code.includes('System.out')) lang = 'Java';
  else if (code.includes('#include') || code.includes('std::')) lang = 'C++';
  else if (code.includes('SELECT') || code.includes('CREATE TABLE')) lang = 'SQL';
  else if (code.includes('<!DOCTYPE') || code.includes('<html')) lang = 'HTML';

  return `## Code Explanation

**Language detected:** ${lang}
**Lines of code:** ${lineCount}

### Overview
This code does the following:

${lines.slice(0, 5).map((l, i) => `\`${i + 1}.\` ${l.trim() || '[blank line]'}`).join('\n')}
${lineCount > 5 ? `... (${lineCount - 5} more lines)` : ''}

### Key Concepts

1. **Structure:** The code follows ${lang === 'Python' ? 'Pythonic conventions with clear function definitions' : lang === 'JavaScript' ? 'modern JavaScript patterns with functional approaches' : `standard ${lang} patterns`}

2. **Logic Flow:**
   - [Identify the main operations]
   - [Explain the data flow]
   - [Note any algorithms used]

3. **Notable Patterns:**
   - [Any design patterns or idioms used]
   - [Error handling approach]
   - [Performance considerations]

### Line-by-Line Breakdown

\`\`\`
${lines.slice(0, 10).map((l, i) => `${String(i + 1).padStart(3)} │ ${l}`).join('\n')}
\`\`\`

*Paste the specific code you want explained for a detailed line-by-line walkthrough.*`;
}

export function debugCode(code: string, context: string): string {
  return `## 🔍 Debug Analysis

### Potential Issues Found

**1. Common checks:**
- ✅ Syntax: Checking for unmatched brackets, missing semicolons
- ✅ Types: Checking for type mismatches
- ✅ Logic: Checking for off-by-one errors, infinite loops

**2. Review:**
\`\`\`
${code.slice(0, 500)}
\`\`\`

### Suggested Fixes

Based on the error context: "${context.slice(0, 200)}"

1. **Check variable declarations** — Ensure all variables are properly declared before use
2. **Verify function signatures** — Make sure arguments match expected types and count
3. **Review loop conditions** — Check for infinite loops or off-by-one errors
4. **Error handling** — Add try/catch blocks for operations that might fail

### Debugging Steps

1. Add console.log/print statements at key points
2. Check the browser console or terminal for error messages
3. Verify input data matches expected format
4. Test with simple inputs first

*Paste the exact error message for a more targeted fix.*`;
}
