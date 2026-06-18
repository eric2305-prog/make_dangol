import type { NotificationTask } from '../components/today-tasks/types';

type SupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          order: (
            column: string,
            options: { ascending: boolean },
          ) => Promise<{ data: NotificationTask[] | null; error: unknown }>;
        };
      };
    };
  };
  rpc: (
    functionName: string,
    args: Record<string, string>,
  ) => Promise<{ data: NotificationTask | null; error: unknown }>;
};

export function getTodayDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function getTodayTasks(supabase: SupabaseLike, storeId: string) {
  const today = getTodayDateKey();
  const { data, error } = await supabase
    .from('notification_tasks')
    .select('id, store_id, type, title, body, payload, target_url, channel, scheduled_for, created_at, sent_at, read_at')
    .eq('store_id', storeId)
    .eq('scheduled_for', today)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function markRead(supabase: SupabaseLike, id: string) {
  const { data, error } = await supabase.rpc('mark_notification_read', { p_id: id });
  if (error) throw error;
  return data;
}
