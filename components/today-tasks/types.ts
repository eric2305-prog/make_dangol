export type NotificationType =
  | 'daily_task_summary'
  | 'ai_message_review_required'
  | 'inactive_customer_warning';

export type NotificationChannel = 'none' | 'kakao';

export interface NotificationTask {
  id: string;
  store_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, number | string>;
  target_url: string;
  channel: NotificationChannel;
  scheduled_for: string;
  created_at: string;
  sent_at: string | null;
  read_at: string | null;
}
