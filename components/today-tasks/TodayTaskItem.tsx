import type { NotificationTask } from './types';
import { NOTI_TYPE_LABEL } from './labels';

export function TodayTaskItem({ task, onClick }: { task: NotificationTask; onClick: () => void }) {
  const read = !!task.read_at;
  return (
    <div
      onClick={onClick}
      className={
        'flex gap-3 items-start rounded-[13px] border p-3.5 cursor-pointer transition ' +
        (read
          ? 'bg-[#FAFAF8] border-[#F2F2F2]'
          : 'bg-white border-[#ECECEC] hover:border-[#D6D6D6] hover:bg-[#FAFAF8]')
      }
    >
      <span className={'flex-none w-[9px] h-[9px] rounded-full mt-1.5 ' + (read ? 'bg-[#3F8E45]' : 'bg-[#E0483C]')} />
      <div className="flex-1 min-w-0">
        <span className="inline-block mb-1.5 text-[.72rem] font-extrabold text-[#B8860B] bg-[#FFF6D6] px-2 py-0.5 rounded-md">
          {NOTI_TYPE_LABEL[task.type]}
        </span>
        <div className={'text-[.96rem] font-bold ' + (read ? 'text-[#767676]' : 'text-[#191919]')}>{task.title}</div>
        <div className={'mt-0.5 text-[.88rem] leading-relaxed ' + (read ? 'text-[#767676]' : 'text-[#3C3C3C]')}>
          {task.body}
        </div>
        <div className="mt-[7px] flex flex-wrap items-center gap-2 text-[.76rem] text-[#767676]">
          <span>낮 12시 생성</span>
          <span className="border border-[#ECECEC] rounded-md px-[7px] py-px font-bold">채널 {task.channel}</span>
          {read && <span className="text-[#3F8E45] font-bold">✓ 확인함</span>}
        </div>
      </div>
    </div>
  );
}
