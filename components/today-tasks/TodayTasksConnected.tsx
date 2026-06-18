'use client';
import { TodayTasks } from './TodayTasks';
import type { NotificationTask } from './types';

interface Props {
  initialTasks: NotificationTask[];
  todayLabel: string;
  onNavigate?: (url: string) => void;
  onMarkRead?: (id: string) => void;
}

export function TodayTasksConnected({
  initialTasks,
  todayLabel,
  onNavigate,
  onMarkRead,
}: Props) {
  return (
    <TodayTasks
      initialTasks={initialTasks}
      todayLabel={todayLabel}
      onNavigate={onNavigate}
      onMarkRead={onMarkRead}
    />
  );
}
