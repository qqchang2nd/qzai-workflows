"use client";
import { useState, useEffect } from 'react';

type Task = {
  id: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assignee: 'MASTER' | 'Q仔';
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  createdAt: string;
};

const statusConfig = {
  TODO: { label: '待办', icon: '📝', color: 'from-orange-400 to-red-500', bg: 'bg-orange-50' },
  IN_PROGRESS: { label: '进行中', icon: '🔄', color: 'from-blue-400 to-cyan-500', bg: 'bg-blue-50' },
  DONE: { label: '已完成', icon: '✅', color: 'from-green-400 to-emerald-500', bg: 'bg-green-50' }
};

const priorityConfig = {
  low: { label: '低', color: 'bg-gray-500/20 text-gray-300 border border-gray-500/30' },
  medium: { label: '中', color: 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30' },
  high: { label: '高', color: 'bg-red-500/20 text-red-300 border border-red-500/30' }
};

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [filter, setFilter] = useState<'ALL' | 'MASTER' | 'Q仔'>('ALL');
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetch('/api/tasks').then(r => r.json()).then(setTasks);
  }, []);

  const addTask = async () => {
    if (!newTask.trim()) return;
    const task = await fetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ 
        title: newTask, 
        status: 'TODO', 
        assignee: 'MASTER', 
        priority: newPriority 
      }),
    }).then(r => r.json());
    setTasks([...tasks, task]);
    setNewTask('');
    setNewPriority('medium');
    setShowAddModal(false);
  };

  const updateStatus = async (id: string, status: Task['status']) => {
    await fetch('/api/tasks', { method: 'PUT', body: JSON.stringify({ id, status }) });
    setTasks(tasks.map(t => t.id === id ? { ...t, status } : t));
  };

  const updateAssignee = async (id: string, assignee: Task['assignee']) => {
    await fetch('/api/tasks', { method: 'PUT', body: JSON.stringify({ id, assignee }) });
    setTasks(tasks.map(t => t.id === id ? { ...t, assignee } : t));
  };

  const updatePriority = async (id: string, priority: Task['priority']) => {
    await fetch('/api/tasks', { method: 'PUT', body: JSON.stringify({ id, priority }) });
    setTasks(tasks.map(t => t.id === id ? { ...t, priority } : t));
  };

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks?id=${id}`, { method: 'DELETE' });
    setTasks(tasks.filter(t => t.id !== id));
  };

  const filteredTasks = tasks.filter(t => filter === 'ALL' || t.assignee === filter);

  const stats = {
    TODO: tasks.filter(t => t.status === 'TODO').length,
    IN_PROGRESS: tasks.filter(t => t.status === 'IN_PROGRESS').length,
    DONE: tasks.filter(t => t.status === 'DONE').length
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              🎯 Mission Control
            </h1>
            <p className="text-slate-400 mt-2">任务指挥中心</p>
          </div>
          
          {/* Stats */}
          <div className="flex gap-4">
            {Object.entries(stats).map(([key, value]) => (
              <div key={key} className={`px-6 py-3 rounded-2xl bg-gradient-to-r ${statusConfig[key as keyof typeof statusConfig].color} shadow-lg`}>
                <div className="text-2xl font-bold text-white">{value}</div>
                <div className="text-white/80 text-sm">{statusConfig[key as keyof typeof statusConfig].label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Add Task */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-8 shadow-xl">
          <div className="flex gap-4">
            <input
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              placeholder="添加新任务..."
              className="flex-1 px-6 py-4 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
              onKeyDown={e => e.key === 'Enter' && addTask()}
            />
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl"
            >
              添加任务
            </button>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-6">
          {(['ALL', 'MASTER', 'Q仔'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full transition-all ${
                filter === f 
                  ? 'bg-purple-500 text-white' 
                  : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              {f === 'ALL' ? '全部' : f === 'MASTER' ? '👤 Master' : '🤖 Q仔'}
            </button>
          ))}
        </div>

        {/* Kanban Board */}
        <div className="grid grid-cols-3 gap-6">
          {(['TODO', 'IN_PROGRESS', 'DONE'] as const).map(status => (
            <div key={status} className="bg-white/5 backdrop-blur-sm rounded-2xl p-4 min-h-[400px]">
              <div className={`flex items-center gap-2 mb-4 pb-4 border-b border-white/10`}>
                <span className="text-2xl">{statusConfig[status].icon}</span>
                <h2 className="text-lg font-bold text-white">{statusConfig[status].label}</h2>
                <span className="ml-auto bg-white/20 px-3 py-1 rounded-full text-sm text-white">
                  {filteredTasks.filter(t => t.status === status).length}
                </span>
              </div>
              
              <div className="space-y-3">
                {filteredTasks.filter(t => t.status === status).map(task => (
                  <div 
                    key={task.id} 
                    className="bg-white/10 hover:bg-white/20 rounded-xl p-4 transition-all cursor-pointer group border border-white/5 hover:border-purple-500/50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium text-white">{task.title}</h3>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteTask(task.id); }}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-all"
                      >
                        ✕
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          updateAssignee(task.id, task.assignee === 'MASTER' ? 'Q仔' : 'MASTER'); 
                        }}
                        className={`text-xs px-2 py-1 rounded-full transition-all cursor-pointer ${
                          task.assignee === 'MASTER' 
                            ? 'bg-blue-500/20 text-blue-300' 
                            : 'bg-green-500/20 text-green-300'
                        }`}
                      >
                        {task.assignee === 'MASTER' ? '👤 Master' : '🤖 Q仔'}
                      </button>
                      
                      <select
                        value={task.priority || 'medium'}
                        onChange={(e) => {
                          e.stopPropagation();
                          updatePriority(task.id, e.target.value as Task['priority']);
                        }}
                        className={`text-xs px-2 py-1 rounded-full border cursor-pointer ${priorityConfig[task.priority || 'medium'].color}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                      </select>
                    </div>
                    
                    <div className="flex gap-1 mt-3 pt-3 border-t border-white/10">
                      {status !== 'TODO' && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); updateStatus(task.id, 'TODO'); }}
                          className="flex-1 py-2 text-xs bg-white/5 hover:bg-orange-500/20 text-orange-300 rounded-lg transition-all"
                        >
                          📝 待办
                        </button>
                      )}
                      {status !== 'IN_PROGRESS' && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); updateStatus(task.id, 'IN_PROGRESS'); }}
                          className="flex-1 py-2 text-xs bg-white/5 hover:bg-blue-500/20 text-blue-300 rounded-lg transition-all"
                        >
                          🔄 进行中
                        </button>
                      )}
                      {status !== 'DONE' && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); updateStatus(task.id, 'DONE'); }}
                          className="flex-1 py-2 text-xs bg-white/5 hover:bg-green-500/20 text-green-300 rounded-lg transition-all"
                        >
                          ✅ 完成
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                
                {filteredTasks.filter(t => t.status === status).length === 0 && (
                  <div className="text-center text-slate-500 py-8">
                    暂无任务
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add Task Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-3xl p-8 w-96 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4">添加新任务</h3>
            
            <input
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              placeholder="任务标题..."
              className="w-full p-4 bg-white/10 rounded-xl text-white mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && addTask()}
            />
            
            <div className="mb-6">
              <label className="block text-sm text-slate-400 mb-2">优先级</label>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setNewPriority(p)}
                    className={`flex-1 py-2 rounded-xl text-sm ${
                      newPriority === p 
                        ? priorityConfig[p].color + ' font-semibold'
                        : 'bg-white/10 text-slate-400 hover:bg-white/20'
                    }`}
                  >
                    {priorityConfig[p].label}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                onClick={() => { setShowAddModal(false); setNewTask(''); }}
                className="flex-1 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors"
              >
                取消
              </button>
              <button 
                onClick={addTask}
                className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:from-purple-600 hover:to-pink-600 transition-colors"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
