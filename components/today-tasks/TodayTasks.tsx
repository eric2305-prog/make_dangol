'use client';
import { useMemo, useState } from 'react';
import type { NotificationTask } from './types';
import { mockNotificationTasks } from './mockNotificationTasks';
import { TodayTasksCard } from './TodayTasksCard';
import { TodayTasksModal } from './TodayTasksModal';

interface Props {
  initialTasks?: NotificationTask[];
  todayLabel?: string;
  onNavigate?: (url: string) => void;
  onMarkRead?: (id: string) => void;
}

export function TodayTasks({
  initialTasks = mockNotificationTasks,
  todayLabel = '오늘',
  onNavigate,
  onMarkRead,
}: Props) {
  const [tasks, setTasks] = useState<NotificationTask[]>(initialTasks);
  const [open, setOpen] = useState(false);

  const unread = useMemo(() => tasks.filter((t) => !t.read_at).length, [tasks]);
  const preview = useMemo(() => {
    if (tasks.length === 0) return '오늘은 챙길 일이 없어요.';
    if (unread === 0) return '오늘 할 일을 모두 확인했어요.';
    return tasks.find((t) => !t.read_at)!.title;
  }, [tasks, unread]);

  const nowIso = () => new Date().toISOString();

  const markRead = (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id && !t.read_at ? { ...t, read_at: nowIso() } : t)));
    onMarkRead?.(id);
  };
  const handleTaskClick = (t: NotificationTask) => {
    markRead(t.id);
    onNavigate?.(t.target_url);
  };
  const markAllRead = () => {
    tasks.filter((t) => !t.read_at).forEach((t) => onMarkRead?.(t.id));
    setTasks((prev) => prev.map((t) => (t.read_at ? t : { ...t, read_at: nowIso() })));
  };

  return (
    <>
      <TodayTasksCard unreadCount={unread} preview={preview} onClick={() => setOpen(true)} />
      <TodayTasksModal
        open={open}
        dateLabel={`${todayLabel} · 낮 12시 생성`}
        tasks={tasks}
        onClose={() => setOpen(false)}
        onTaskClick={handleTaskClick}
        onReadAll={markAllRead}
      />
    </>
  );
}
