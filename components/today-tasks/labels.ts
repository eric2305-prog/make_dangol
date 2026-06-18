import type { NotificationType } from './types';

export const NOTI_TYPE_LABEL: Record<NotificationType, string> = {
  daily_task_summary: '오늘 업무 요약',
  ai_message_review_required: 'AI 메시지 승인 필요',
  inactive_customer_warning: '휴면 고객 주의',
};
