import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DB_PATH = path.join(process.cwd(), 'database.json');

interface Task {
  id: string;
  title: string;
  description: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "low" | "medium" | "high";
  assignee: "MASTER" | "Q仔";
  createdAt: string;
  dueDate: string;
}

function readTasks(): Task[] {
  if (!fs.existsSync(DB_PATH)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeTasks(tasks: Task[]) {
  fs.writeFileSync(DB_PATH, JSON.stringify(tasks, null, 2));
}

export async function GET() {
  return NextResponse.json(readTasks());
}

export async function POST(request: Request) {
  const { title, description, status, priority, assignee, dueDate } = await request.json();
  const tasks = readTasks();
  const newTask: Task = {
    id: uuidv4(),
    title,
    description,
    status: status || "TODO",
    priority: priority || "medium",
    assignee: assignee || "MASTER",
    createdAt: new Date().toISOString(),
    dueDate: dueDate || null, // dueDate can be null initially
  };
  tasks.push(newTask);
  writeTasks(tasks);
  return NextResponse.json(newTask);
}

export async function PUT(request: Request) {
  const { id, ...updates } = await request.json();
  const tasks = readTasks();
  const index = tasks.findIndex(t => t.id === id);
  if (index !== -1) {
    tasks[index] = { ...tasks[index], ...updates };
    writeTasks(tasks);
    return NextResponse.json(tasks[index]);
  }
  return NextResponse.json({ error: 'Task not found' }, { status: 404 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const tasks = readTasks();
  const filtered = tasks.filter(t => t.id !== id);
  writeTasks(filtered);
  return NextResponse.json({ success: true });
}
