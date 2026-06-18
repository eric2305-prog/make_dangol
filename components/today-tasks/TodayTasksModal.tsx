import type { NotificationTask } from './types';
import { TodayTaskItem } from './TodayTaskItem';

interface Props {
  open: boolean;
  dateLabel: string;
  tasks: NotificationTask[];
  onClose: () => void;
  onTaskClick: (t: NotificationTask) => void;
  onReadAll: () => void;
}

export function TodayTasksModal({ open, dateLabel, tasks, onClose, onTaskClick, onReadAll }: Props) {
  if (!open) return null;
  const isEmpty = tasks.length === 0;
  const hasUnread = tasks.some((t) => !t.read_at);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(25,25,25,.45)] p-5"
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[440px] max-h-[90vh] overflow-auto rounded-[22px] bg-white shadow-[0_26px_60px_rgba(25,25,25,.14)]"
      >
        <div className="flex items-center justify-between gap-2.5 px-[22px] pt-5 pb-4 border-b border-[#ECECEC]">
          <div>
            <h3 className="text-[1.16rem] font-extrabold">오늘 할 일</h3>
            <div className="mt-0.5 text-[.82rem] font-semibold text-[#767676]">{dateLabel}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="flex-none w-[34px] h-[34px] rounded-[9px] border border-[#ECECEC] bg-white text-[1.1rem] leading-none text-[#767676] hover:border-[#191919] hover:text-[#191919] hover:bg-[#FAFAF8]"
          >
            ✕
          </button>
        </div>

        <div className="px-[22px] py-5">
          {isEmpty ? (
            <div className="py-6 text-center text-[.94rem] leading-relaxed text-[#767676]">
              오늘은 따로 챙길 일이 없습니다. 좋은 하루 보내세요!
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {tasks.map((t) => (
                <TodayTaskItem key={t.id} task={t} onClick={() => onTaskClick(t)} />
              ))}
            </div>
          )}
        </div>

        {!isEmpty && hasUnread && (
          <div className="px-[22px] pt-2 pb-[22px]">
            <button
              onClick={onReadAll}
              className="w-full rounded-xl border border-[#ECECEC] bg-white py-[15px] text-[1.06rem] font-bold text-[#191919] hover:bg-[#FAFAF8]"
            >
              모두 읽음 처리
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
